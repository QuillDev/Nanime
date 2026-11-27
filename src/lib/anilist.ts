import type { AniListMedia, MediaEntry } from "../types.ts";
import { parseNumberedName, type NumberedName } from "../../shared/numberedName.ts";

interface EpisodeMetadata {
  readonly title: string;
  readonly thumbnail: string | null;
}

export function mediaTitle(media: AniListMedia): string {
  return media.title.english ?? media.title.romaji;
}

/** An organized file's `NNN. Title`, read from its name without the extension. */
export function numberedEpisode(entry: MediaEntry): NumberedName | null {
  return parseNumberedName(entry.name.replace(/\.[^.]+$/u, ""));
}

const streamingEpisodeIndex = new WeakMap<
  AniListMedia["streamingEpisodes"],
  ReadonlyMap<number, EpisodeMetadata>
>();

function fallbackEpisodeNumber(name: string): number | null {
  const match = /S\d+E(?<number>\d+)/iu.exec(name)
    ?? /\b(?:Episode|Ep|E)\s*0*(?<number>\d+)/iu.exec(name)
    ?? /\s-\s0*(?<number>\d+)(?:\s|[._-])/u.exec(name);
  const number = match?.groups?.["number"];
  return number === undefined ? null : Number(number);
}

export function episodeNumber(entry: MediaEntry): number | null {
  return numberedEpisode(entry)?.number ?? fallbackEpisodeNumber(entry.name);
}

function streamingEpisodeNumber(title: string): number | null {
  const number = /^Episode\s+(?<number>\d+)/iu.exec(title)?.groups?.["number"];
  return number === undefined ? null : Number(number);
}

function episodeTitle(title: string): string {
  return title.replace(/^Episode\s+\d+\s*-\s*/iu, "").trim();
}

function indexStreamingEpisodes(
  episodes: AniListMedia["streamingEpisodes"],
): ReadonlyMap<number, EpisodeMetadata> {
  const cached = streamingEpisodeIndex.get(episodes);
  if (cached !== undefined) {
    return cached;
  }
  const index = new Map<number, EpisodeMetadata>();
  for (const candidate of episodes) {
    const number = streamingEpisodeNumber(candidate.title);
    if (number !== null && !index.has(number)) {
      index.set(number, {
        title: episodeTitle(candidate.title),
        thumbnail: candidate.thumbnail,
      });
    }
  }
  streamingEpisodeIndex.set(episodes, index);
  return index;
}

export function episodeMetadata(entry: MediaEntry, media: AniListMedia | undefined): EpisodeMetadata | null {
  const numbered = numberedEpisode(entry);
  const number = numbered === null ? fallbackEpisodeNumber(entry.name) : numbered.number;
  if (number === null) {
    return null;
  }
  const fetched = media === undefined
    ? null
    : indexStreamingEpisodes(media.streamingEpisodes).get(number) ?? null;
  // An organized file's name is its title; fetched metadata only adds art and details.
  if (numbered === null) {
    return fetched;
  }
  return fetched === null
    ? { title: numbered.title, thumbnail: null }
    : { ...fetched, title: numbered.title };
}
