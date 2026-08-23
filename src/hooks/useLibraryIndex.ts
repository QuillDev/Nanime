import { useMemo } from "react";
import type { AniListPlaybackTarget, MediaEntry, ShowMetadata } from "../types.ts";
import { useShowMetadata } from "./useShowMetadata.ts";
import {
  groupShows,
  seasonMetadata,
  showMetadataKey,
  type SeasonGroup,
  type ShowGroup,
} from "../lib/library.ts";
import { episodeNumber } from "../lib/anilist.ts";

export interface LibraryIndex {
  readonly shows: readonly ShowGroup[];
  readonly metadata: ShowMetadata;
  readonly entriesByRel: ReadonlyMap<string, MediaEntry>;
  readonly previousByRel: ReadonlyMap<string, MediaEntry>;
  readonly nextByRel: ReadonlyMap<string, MediaEntry>;
  readonly playbackTargetByRel: ReadonlyMap<string, AniListPlaybackTarget>;
}

interface MutableLibraryIndex {
  readonly entries: Map<string, MediaEntry>;
  readonly previous: Map<string, MediaEntry>;
  readonly next: Map<string, MediaEntry>;
  readonly targets: Map<string, AniListPlaybackTarget>;
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
    indexSeasonTargets({ season, show, metadata, targets: index.targets });
  }
}

interface SeasonTargetOptions {
  readonly season: SeasonGroup;
  readonly show: ShowGroup;
  readonly metadata: ShowMetadata;
  readonly targets: Map<string, AniListPlaybackTarget>;
}

function indexSeasonTargets(options: SeasonTargetOptions): void {
  const { season, show, metadata, targets } = options;
  const media = seasonMetadata(metadata, season.sourceShow, season.name) ??
    metadata[showMetadataKey(show.name)];
  if (media === undefined) {
    return;
  }
  for (const entry of season.entries) {
    const episode = episodeNumber(entry);
    if (episode !== null) {
      targets.set(entry.rel, { mediaId: media.id, episode, totalEpisodes: media.episodes });
    }
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
  };
}

export function useLibraryIndex(
  entries: readonly MediaEntry[],
): LibraryIndex {
  const metadata = useShowMetadata().data ?? EMPTY_METADATA;
  return useMemo(() => buildLibraryIndex(entries, metadata), [entries, metadata]);
}
