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
  partitionShowsByMetadata,
  primaryShowMetadata,
  seasonMetadata,
  sortShowsByMetadataTitle,
  type SeasonGroup,
  type ShowGroup,
} from "../lib/library.ts";
import { episodeMetadata, episodeNumber, mediaTitle } from "../lib/anilist.ts";

export interface LibraryIndex {
  readonly shows: readonly ShowGroup[];
  readonly metadata: ShowMetadata;
  readonly metadataPending: boolean;
  readonly metadataError: Error | null;
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
  readonly targets: Map<string, AniListPlaybackTarget>;
  readonly displays: Map<string, EpisodeDisplay>;
}

function entryDisplay(options: EntryTargetOptions): EpisodeDisplay {
  const { entry, media, movie } = options;
  const episode = episodeNumber(entry);
  const details = movie ? undefined : episodeMetadata(entry, media);
  return {
    number: movie ? null : episode,
    title: movie && media !== undefined
      ? media.title.english ?? media.title.romaji
      : details?.title ?? entry.name.replace(/\.[^.]+$/u, ""),
  };
}

function entryPlaybackTarget(options: EntryTargetOptions): AniListPlaybackTarget | null {
  const { entry, media, movie } = options;
  const episode = episodeNumber(entry);
  if (movie && media?.anilistId !== null && media?.anilistId !== undefined) {
    return {
      mediaId: media.anilistId,
      episode: 1,
      totalEpisodes: 1,
      title: mediaTitle(media),
    };
  }
  if (episode !== null && media?.anilistId !== null && media?.anilistId !== undefined) {
    return {
      mediaId: media.anilistId,
      episode,
      totalEpisodes: media.episodes,
      title: mediaTitle(media),
    };
  }
  return null;
}

function indexSeasonEntry(options: EntryTargetOptions): void {
  const { entry, targets, displays } = options;
  displays.set(entry.rel, entryDisplay(options));
  const target = entryPlaybackTarget(options);
  if (target !== null) {
    targets.set(entry.rel, target);
  }
}

function indexSeason(options: SeasonTargetOptions): void {
  const { season, show, metadata, targets, displays } = options;
  const media = seasonMetadata(metadata, season.sourceShow, season.name) ??
    primaryShowMetadata(show, metadata);
  for (const entry of season.entries) {
    indexSeasonEntry({
      entry,
      media,
      movie: isMovieMedia(media),
      targets,
      displays,
    });
  }
}

interface LibraryIndexOptions {
  readonly entries: readonly MediaEntry[];
  readonly metadata: ShowMetadata;
  readonly metadataPending: boolean;
  readonly metadataError: Error | null;
}

function buildLibraryIndex(options: LibraryIndexOptions): LibraryIndex {
  const { entries, metadata, metadataPending, metadataError } = options;
  const allShows = groupShows(entries, metadata);
  const shows = partitionShowsByMetadata(allShows, metadata);
  const mappedShows = sortShowsByMetadataTitle(shows.mapped, metadata);
  const index = {
    entries: new Map<string, MediaEntry>(),
    previous: new Map<string, MediaEntry>(),
    next: new Map<string, MediaEntry>(),
    targets: new Map<string, AniListPlaybackTarget>(),
    displays: new Map<string, EpisodeDisplay>(),
  };
  for (const show of mappedShows) {
    indexShow(show, metadata, index);
  }
  return {
    shows: mappedShows,
    metadata,
    metadataPending,
    metadataError,
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
  const metadataQuery = useShowMetadata();
  const metadata = metadataQuery.data ?? EMPTY_METADATA;
  return useMemo(() => buildLibraryIndex({
    entries,
    metadata,
    metadataPending: metadataQuery.status === "pending",
    metadataError: metadataQuery.error,
  }), [entries, metadata, metadataQuery.error, metadataQuery.status]);
}
