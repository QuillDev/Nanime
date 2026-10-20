import type { AniListMedia, MediaEntry, TvmazeEpisode } from "../types.ts";
import { parseNumberedName, type NumberedName } from "../../shared/numberedName.ts";

interface EpisodeMetadata {
  readonly title: string;
  readonly thumbnail: string | null;
  readonly summary: string | null;
  readonly airDate: string | null;
}

interface EpisodeMetadataContext {
  readonly showMedia: AniListMedia | undefined;
  readonly season: number;
}

export function mediaTitle(media: AniListMedia): string {
  return media.title.english ?? media.title.romaji;
}

/** An organized file's `NNN. Title`, read from its name without the extension. */
export function numberedEpisode(entry: MediaEntry): NumberedName | null {
  return parseNumberedName(entry.name.replace(/\.[^.]+$/u, ""));
}

export function episodeNumber(entry: MediaEntry): number | null {
  const numbered = numberedEpisode(entry);
  if (numbered !== null) {
    return numbered.number;
  }
  const match = /S\d+E(?<number>\d+)/iu.exec(entry.name)
    ?? /\b(?:Episode|Ep|E)\s*0*(?<number>\d+)/iu.exec(entry.name)
    ?? /\s-\s0*(?<number>\d+)(?:\s|[._-])/u.exec(entry.name);
  const number = match?.groups?.["number"];
  return number === undefined ? null : Number(number);
}

function streamingEpisodeNumber(title: string): number | null {
  const number = /^Episode\s+(?<number>\d+)/iu.exec(title)?.groups?.["number"];
  return number === undefined ? null : Number(number);
}

function episodeTitle(title: string): string {
  return title.replace(/^Episode\s+\d+\s*-\s*/iu, "").trim();
}

function episodeMetadataTitle(
  entry: MediaEntry,
  aniListEpisode: { readonly title: string } | undefined,
  tvmazeEpisode: TvmazeEpisode | undefined,
): string {
  return aniListEpisode === undefined
    ? tvmazeEpisode?.title ?? entry.name
    : episodeTitle(aniListEpisode.title);
}

function tvmazeEpisodeNumber(
  episodes: readonly TvmazeEpisode[],
  season: number,
  number: number,
): number | null {
  const direct = episodes.find((candidate) => (
    candidate.season === season && candidate.number === number
  ));
  if (direct !== undefined) {
    return direct.id;
  }
  const earlierEpisodeCount = episodes.filter((candidate) => (
    candidate.season < season && candidate.number !== null
  )).length;
  return episodes.find((candidate) => (
    candidate.season === season && candidate.number !== null &&
    earlierEpisodeCount + candidate.number === number
  ))?.id ?? null;
}

function findTvmazeEpisode(
  context: EpisodeMetadataContext | undefined,
  number: number,
): TvmazeEpisode | undefined {
  const episodes = context?.showMedia?.tvmaze?.episodes;
  const season = context?.season;
  if (episodes === undefined || season === undefined) {
    return undefined;
  }
  if (number === 0) {
    return episodes.find((candidate) => (
      candidate.season === season && candidate.number === null &&
      candidate.type === "significant_special"
    ));
  }
  const id = tvmazeEpisodeNumber(episodes, season, number);
  return episodes.find((candidate) => candidate.id === id);
}

function providerEpisodeMetadata(
  entry: MediaEntry,
  media: AniListMedia | undefined,
  context: EpisodeMetadataContext | undefined,
): EpisodeMetadata | null {
  const number = episodeNumber(entry) ?? Number.NaN;
  const aniListEpisode = media?.streamingEpisodes.find(
    (candidate) => streamingEpisodeNumber(candidate.title) === number,
  );
  const tvmazeEpisode = findTvmazeEpisode(context, number);
  if (aniListEpisode === undefined && tvmazeEpisode === undefined) {
    return null;
  }
  return {
    title: episodeMetadataTitle(entry, aniListEpisode, tvmazeEpisode),
    thumbnail: aniListEpisode?.thumbnail ?? tvmazeEpisode?.thumbnail ?? null,
    summary: tvmazeEpisode?.summary ?? null,
    airDate: tvmazeEpisode?.airDate ?? null,
  };
}

export function episodeMetadata(
  entry: MediaEntry,
  media: AniListMedia | undefined,
  context?: EpisodeMetadataContext,
): EpisodeMetadata | null {
  const number = episodeNumber(entry);
  if (number === null) {
    return null;
  }
  const fetched = providerEpisodeMetadata(entry, media, context);
  // An organized file's name is its title; fetched metadata only adds art and details.
  const named = numberedEpisode(entry)?.title;
  if (named === undefined) {
    return fetched;
  }
  return fetched === null ? { title: named, thumbnail: null, summary: null, airDate: null } : { ...fetched, title: named };
}
