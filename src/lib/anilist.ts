import type { AniListMedia, MediaEntry, TvmazeEpisode } from "../types.ts";

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

export function episodeNumber(entry: MediaEntry): number | null {
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

export function episodeMetadata(
  entry: MediaEntry,
  media: AniListMedia | undefined,
  context?: EpisodeMetadataContext,
): EpisodeMetadata | null {
  const number = episodeNumber(entry);
  if (number === null) {
    return null;
  }
  const aniListEpisode = media?.streamingEpisodes.find(
    (candidate) => streamingEpisodeNumber(candidate.title) === number,
  );
  const tvmazeEpisode = findTvmazeEpisode(context, number);
  if (aniListEpisode === undefined && tvmazeEpisode === undefined) {
    return null;
  }
  return {
    title: aniListEpisode === undefined
      ? tvmazeEpisode?.title ?? entry.name
      : episodeTitle(aniListEpisode.title),
    thumbnail: aniListEpisode?.thumbnail ?? tvmazeEpisode?.thumbnail ?? null,
    summary: tvmazeEpisode?.summary ?? null,
    airDate: tvmazeEpisode?.airDate ?? null,
  };
}
