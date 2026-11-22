import type { MediaEntry, PlaybackProgressMap } from "../types.ts";
import { hasMeaningfulPlaybackProgress } from "./playback.ts";

export interface WatchView {
  readonly percent: number;
  /** Seconds left in a started, unfinished episode. */
  readonly remaining: number | null;
  readonly watched: boolean;
}

/** How far along an episode is, for its row. */
export function watchView(entry: MediaEntry, progress: PlaybackProgressMap): WatchView {
  const item = progress[entry.rel];
  if (item === undefined || item.completed) {
    return { percent: 0, remaining: null, watched: item?.completed === true };
  }
  const started = item.duration > 0 && hasMeaningfulPlaybackProgress(item.position);
  return {
    percent: started ? Math.min(100, item.position / item.duration * 100) : 0,
    remaining: started ? Math.max(item.duration - item.position, 0) : null,
    watched: false,
  };
}
