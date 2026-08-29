import type { PlaybackProgressMap } from "../types.ts";
import type { ShowGroup } from "./library.ts";

export interface WatchedShowPartition {
  readonly unwatched: readonly ShowGroup[];
  readonly watched: readonly ShowGroup[];
}

export function isShowWatched(show: ShowGroup, progress: PlaybackProgressMap): boolean {
  return show.entries.length > 0 && show.entries.every((entry) => (
    progress[entry.rel]?.completed === true
  ));
}

export function partitionShowsByWatched(
  shows: readonly ShowGroup[],
  progress: PlaybackProgressMap,
): WatchedShowPartition {
  const watched: ShowGroup[] = [];
  const unwatched: ShowGroup[] = [];
  for (const show of shows) {
    (isShowWatched(show, progress) ? watched : unwatched).push(show);
  }
  return { unwatched, watched };
}
