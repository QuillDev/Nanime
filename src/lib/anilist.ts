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

function providerEpisodeMetadata(entry: MediaEntry, media: AniListMedia | undefined): EpisodeMetadata | null {
  const number = episodeNumber(entry) ?? Number.NaN;
  const aniListEpisode = media?.streamingEpisodes.find(
    (candidate) => streamingEpisodeNumber(candidate.title) === number,
  );
  return aniListEpisode === undefined
    ? null
    : { title: episodeTitle(aniListEpisode.title), thumbnail: aniListEpisode.thumbnail };
}

export function episodeMetadata(entry: MediaEntry, media: AniListMedia | undefined): EpisodeMetadata | null {
  const number = episodeNumber(entry);
  if (number === null) {
    return null;
  }
  const fetched = providerEpisodeMetadata(entry, media);
  // An organized file's name is its title; fetched metadata only adds art and details.
  const named = numberedEpisode(entry)?.title;
  if (named === undefined) {
    return fetched;
  }
  return fetched === null ? { title: named, thumbnail: null } : { ...fetched, title: named };
}
