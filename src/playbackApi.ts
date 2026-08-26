import { api, unwrap } from "./api.ts";
import type { PlaybackProgress } from "./types.ts";

export async function fetchPlaybackProgress(
  signal: AbortSignal,
): Promise<readonly PlaybackProgress[]> {
  return unwrap(
    await api.api.progress.get({ fetch: { signal } }),
    "Playback progress request",
  );
}

export interface PlaybackProgressUpdate {
  readonly rel: string;
  readonly position: number;
  readonly duration: number;
  readonly completed: boolean;
  readonly anilistMediaId?: number;
  readonly episode?: number;
  readonly totalEpisodes?: number | null;
}

export async function savePlaybackProgress(
  update: PlaybackProgressUpdate,
): Promise<PlaybackProgress> {
  return unwrap(await api.api.progress.put(update), "Saving playback progress");
}

export async function dismissPlaybackProgress(rel: string): Promise<PlaybackProgress> {
  return unwrap(
    await api.api.progress.dismiss.post({ rel }),
    "Dismissing Continue Watching item",
  );
}

export async function setPlaybackWatched(
  rel: string,
  watched: boolean,
): Promise<PlaybackProgress> {
  return unwrap(
    await api.api.progress.watched.post({ rel, watched }),
    watched ? "Marking episode watched" : "Marking episode unwatched",
  );
}
