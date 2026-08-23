import type { AniListMedia } from "./anilist.ts";

const TVMAZE_URL = "https://api.tvmaze.com";

export interface TvmazeEpisode {
  readonly id: number;
  readonly season: number;
  readonly number: number | null;
  readonly type: string;
  readonly title: string;
  readonly summary: string | null;
  readonly airDate: string | null;
  readonly thumbnail: string | null;
}

export interface TvmazeMatch {
  readonly id: number;
  readonly name: string;
  readonly siteUrl: string;
  readonly premiered: string | null;
  readonly episodes: readonly TvmazeEpisode[];
}

interface TvmazeShow {
  readonly id: number;
  readonly name: string;
  readonly url: string;
  readonly premiered: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedTitle(value: string): string {
  return value.toLowerCase().replaceAll(/[^\p{Letter}\p{Number}]+/gu, "");
}

function showFromResult(value: unknown): TvmazeShow | null {
  const result = record(value);
  const show = record(result?.["show"]);
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
  const episode = record(value);
  const image = record(episode?.["image"]);
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

function titleCandidates(media: AniListMedia): readonly string[] {
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

export async function matchTvmaze(media: AniListMedia): Promise<TvmazeMatch | null> {
  const titles = titleCandidates(media);
  for (const title of titles) {
    const response = await fetch(`${TVMAZE_URL}/search/shows?q=${encodeURIComponent(title)}`);
    if (!response.ok) {
      throw new Error(`TVmaze returned HTTP ${String(response.status)}`);
    }
    const payload: unknown = await response.json();
    const show = Array.isArray(payload)
      ? exactShow(payload, titles, media.seasonYear)
      : null;
    if (show !== null) {
      const episodesResponse = await fetch(
        `${TVMAZE_URL}/shows/${String(show.id)}/episodes?specials=1`,
      );
      if (!episodesResponse.ok) {
        throw new Error(`TVmaze returned HTTP ${String(episodesResponse.status)}`);
      }
      const episodesPayload: unknown = await episodesResponse.json();
      const episodes = Array.isArray(episodesPayload)
        ? episodesPayload.map((episode) => episodeFromResult(episode)).filter(
          (episode): episode is TvmazeEpisode => episode !== null,
        )
        : [];
      return {
        id: show.id,
        name: show.name,
        siteUrl: show.url,
        premiered: show.premiered,
        episodes,
      };
    }
  }
  return null;
}
