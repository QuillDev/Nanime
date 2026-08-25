import { useMemo } from "react";
import type {
  AniListMedia,
  AniListPlaybackTarget,
  EpisodeDisplay,
  MediaEntry,
  ShowMetadata,
} from "../types.ts";
import { useShowMetadata } from "./useShowMetadata.ts";
import {
  groupShows,
  isMovieMedia,
  primaryShowMetadata,
  seasonMetadata,
  seasonNumber,
  type SeasonGroup,
  type ShowGroup,
} from "../lib/library.ts";
import { episodeMetadata, episodeNumber } from "../lib/anilist.ts";

export interface LibraryIndex {
  readonly shows: readonly ShowGroup[];
  readonly metadata: ShowMetadata;
  readonly entriesByRel: ReadonlyMap<string, MediaEntry>;
  readonly previousByRel: ReadonlyMap<string, MediaEntry>;
  readonly nextByRel: ReadonlyMap<string, MediaEntry>;
  readonly playbackTargetByRel: ReadonlyMap<string, AniListPlaybackTarget>;
  readonly displayByRel: ReadonlyMap<string, EpisodeDisplay>;
}

interface MutableLibraryIndex {
  readonly entries: Map<string, MediaEntry>;
  readonly previous: Map<string, MediaEntry>;
  readonly next: Map<string, MediaEntry>;
  readonly targets: Map<string, AniListPlaybackTarget>;
  readonly displays: Map<string, EpisodeDisplay>;
}

const EMPTY_METADATA: ShowMetadata = {};

function indexAdjacency(
  ordered: readonly MediaEntry[],
  index: MutableLibraryIndex,
): void {
  for (const [position, entry] of ordered.entries()) {
    index.entries.set(entry.rel, entry);
    const previous = ordered[position - 1];
    const next = ordered[position + 1];
    if (previous !== undefined) {
      index.previous.set(entry.rel, previous);
    }
    if (next !== undefined) {
      index.next.set(entry.rel, next);
    }
  }
}

function indexShow(
  show: ShowGroup,
  metadata: ShowMetadata,
  index: MutableLibraryIndex,
): void {
  const ordered = show.seasons.flatMap((season) => season.entries);
  indexAdjacency(ordered, index);
  for (const season of show.seasons) {
    indexSeason({
      season,
      show,
      metadata,
      targets: index.targets,
      displays: index.displays,
    });
  }
}

interface SeasonTargetOptions {
  readonly season: SeasonGroup;
  readonly show: ShowGroup;
  readonly metadata: ShowMetadata;
  readonly targets: Map<string, AniListPlaybackTarget>;
  readonly displays: Map<string, EpisodeDisplay>;
}

interface EntryTargetOptions {
  readonly entry: MediaEntry;
  readonly media: AniListMedia | undefined;
  readonly movie: boolean;
  readonly seasonNumber: number;
  readonly showMedia: AniListMedia | undefined;
  readonly targets: Map<string, AniListPlaybackTarget>;
  readonly displays: Map<string, EpisodeDisplay>;
}

function indexSeasonEntry(options: EntryTargetOptions): void {
  const { entry, media, movie, seasonNumber: number, showMedia, targets, displays } = options;
  const episode = episodeNumber(entry);
  const details = movie ? undefined : episodeMetadata(entry, media, { showMedia, season: number });
  displays.set(entry.rel, {
    number: movie ? null : episode,
    title: movie && media !== undefined
      ? media.title.english ?? media.title.romaji
      : details?.title ?? entry.name.replace(/\.[^.]+$/u, ""),
  });
  if (movie && media?.anilistId !== null && media?.anilistId !== undefined) {
    targets.set(entry.rel, { mediaId: media.anilistId, episode: 1, totalEpisodes: 1 });
  } else if (episode !== null && media?.anilistId !== null && media?.anilistId !== undefined) {
    targets.set(entry.rel, { mediaId: media.anilistId, episode, totalEpisodes: media.episodes });
  }
}

function indexSeason(options: SeasonTargetOptions): void {
  const { season, show, metadata, targets, displays } = options;
  const showMedia = primaryShowMetadata(show, metadata);
  const media = seasonMetadata(metadata, season.sourceShow, season.name) ??
    showMedia;
  const number = seasonNumber(season, media);
  for (const entry of season.entries) {
    indexSeasonEntry({
      entry,
      media,
      movie: isMovieMedia(media),
      seasonNumber: number,
      showMedia,
      targets,
      displays,
    });
  }
}

function buildLibraryIndex(
  entries: readonly MediaEntry[],
  metadata: ShowMetadata,
): LibraryIndex {
  const shows = groupShows(entries, metadata);
  const index = {
    entries: new Map<string, MediaEntry>(),
    previous: new Map<string, MediaEntry>(),
    next: new Map<string, MediaEntry>(),
    targets: new Map<string, AniListPlaybackTarget>(),
    displays: new Map<string, EpisodeDisplay>(),
  };
  for (const show of shows) {
    indexShow(show, metadata, index);
  }
  return {
    shows,
    metadata,
    entriesByRel: index.entries,
    previousByRel: index.previous,
    nextByRel: index.next,
    playbackTargetByRel: index.targets,
    displayByRel: index.displays,
  };
}

export function useLibraryIndex(
  entries: readonly MediaEntry[],
): LibraryIndex {
  const metadata = useShowMetadata().data ?? EMPTY_METADATA;
  return useMemo(() => buildLibraryIndex(entries, metadata), [entries, metadata]);
}
