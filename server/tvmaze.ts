import type { TvmazeEpisode, TvmazeMatch } from "../shared/types.ts";
import { jsonObject } from "./json.ts";
import type { AnimeMetadata } from "./metadataTypes.ts";

const TVMAZE_URL = "https://api.tvmaze.com";

interface TvmazeShow {
  readonly id: number;
  readonly name: string;
  readonly url: string;
  readonly premiered: string | null;
}

function normalizedTitle(value: string): string {
  return value.toLowerCase().replaceAll(/[^\p{Letter}\p{Number}]+/gu, "");
}

function showFromResult(value: unknown): TvmazeShow | null {
  const result = jsonObject(value);
  const show = jsonObject(result?.["show"]);
  if (
    typeof show?.["id"] !== "number" ||
    typeof show["name"] !== "string" ||
    typeof show["url"] !== "string" ||
    !(typeof show["premiered"] === "string" || show["premiered"] === null)
  ) {
    return null;
  }
  return {
    id: show["id"],
    name: show["name"],
    url: show["url"],
    premiered: show["premiered"],
  };
}

export function plainText(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const result: string[] = [];
  let insideTag = false;
  for (const character of value) {
    if (character === "<") {
      insideTag = true;
      result.push(" ");
    } else if (character === ">") {
      insideTag = false;
    } else if (!insideTag) {
      result.push(character);
    }
  }
  return result.join("").replaceAll(/\s+/gu, " ").trim() || null;
}

function episodeFromResult(value: unknown): TvmazeEpisode | null {
  const episode = jsonObject(value);
  const image = jsonObject(episode?.["image"]);
  if (
    typeof episode?.["id"] !== "number" ||
    typeof episode["season"] !== "number" ||
    !(typeof episode["number"] === "number" || episode["number"] === null) ||
    typeof episode["type"] !== "string" ||
    typeof episode["name"] !== "string"
  ) {
    return null;
  }
  return {
    id: episode["id"],
    season: episode["season"],
    number: episode["number"],
    type: episode["type"],
    title: episode["name"],
    summary: plainText(typeof episode["summary"] === "string" ? episode["summary"] : null),
    airDate: typeof episode["airdate"] === "string" ? episode["airdate"] : null,
    thumbnail: typeof image?.["original"] === "string" ? image["original"] : null,
  };
}

function titleCandidates(media: AnimeMetadata): readonly string[] {
  return [...new Set([media.title.english, media.title.romaji].filter(
    (title): title is string => title !== null && title !== "",
  ))];
}

function exactShow(
  values: readonly unknown[],
  titles: readonly string[],
  year: number | null,
): TvmazeShow | null {
  const normalized = new Set(titles.map((title) => normalizedTitle(title)));
  return values.map((value) => showFromResult(value)).find((show) => {
    if (show === null || !normalized.has(normalizedTitle(show.name))) {
      return false;
    }
    const premieredYear = show.premiered === null ? null : Number(show.premiered.slice(0, 4));
    return year === null || premieredYear === year;
  }) ?? null;
}

const SEASON_SUFFIX = /[\s:,-]*(?:Season\s*0*(?<plain>\d+)|(?<ordinal>\d+)(?:st|nd|rd|th)\s+Season)\s*$/iu;

/**
 * AniList lists later seasons as their own media ("... Season 3", "... 3rd
 * Season"); TVmaze keeps one show holding every season. Strip that suffix to
 * find the parent show.
 */
export function seasonedTitle(title: string): { readonly base: string; readonly season: number } | null {
  const match = SEASON_SUFFIX.exec(title);
  const number = match?.groups?.["plain"] ?? match?.groups?.["ordinal"];
  if (match === null || number === undefined) {
    return null;
  }
  const base = title.slice(0, match.index).trim();
  return base === "" ? null : { base, season: Number(number) };
}

interface ShowQuery {
  readonly search: readonly string[];
  readonly names: readonly string[];
  /** Premiere year the show must match; null accepts any. */
  readonly year: number | null;
  /** Season the show must contain episodes for; null accepts any. */
  readonly season: number | null;
}

function showQueries(media: AnimeMetadata): readonly ShowQuery[] {
  const titles = titleCandidates(media);
  const seasoned = titles.map((title) => seasonedTitle(title)).filter((value) => value !== null);
  const bases = [...new Set(seasoned.map((value) => value.base))];
  const exact = { search: titles, names: titles, year: media.seasonYear, season: null };
  const season = seasoned[0]?.season;
  // A later season premieres years after its parent show, so only the season's episodes vouch for the match.
  return season === undefined ? [exact] : [exact, { search: bases, names: bases, year: null, season }];
}

/** TVmaze answers these endpoints with arrays; anything else counts as no results. */
async function tvmazeList(path: string): Promise<readonly unknown[]> {
  const response = await fetch(`${TVMAZE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`TVmaze returned HTTP ${String(response.status)}`);
  }
  const payload: unknown = await response.json();
  return Array.isArray(payload) ? payload : [];
}

async function showEpisodes(show: TvmazeShow): Promise<readonly TvmazeEpisode[]> {
  const payload = await tvmazeList(`/shows/${String(show.id)}/episodes?specials=1`);
  return payload.map((episode) => episodeFromResult(episode)).filter(
    (episode): episode is TvmazeEpisode => episode !== null,
  );
}

async function queryMatch(query: ShowQuery): Promise<TvmazeMatch | null> {
  for (const title of query.search) {
    const show = exactShow(await tvmazeList(`/search/shows?q=${encodeURIComponent(title)}`), query.names, query.year);
    if (show !== null) {
      const episodes = await showEpisodes(show);
      const hasSeason = query.season === null || episodes.some((episode) => episode.season === query.season);
      return hasSeason
        ? { id: show.id, name: show.name, siteUrl: show.url, premiered: show.premiered, episodes }
        : null;
    }
  }
  return null;
}

export async function matchTvmaze(media: AnimeMetadata): Promise<TvmazeMatch | null> {
  for (const query of showQueries(media)) {
    const match = await queryMatch(query);
    if (match !== null) {
      return match;
    }
  }
  return null;
}
