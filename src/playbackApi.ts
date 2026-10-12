import { api, unwrap } from "./api.ts";
import type { PlaybackProgress } from "./types.ts";
import {
  canUseOfflineFallback,
  flushOfflinePlayback,
  offlineProgressFallback,
  rememberOfflineProgress,
  saveOfflinePlayback,
} from "./offline/runtime.ts";

export async function fetchPlaybackProgress(
  signal: AbortSignal,
): Promise<readonly PlaybackProgress[]> {
  try {
    const progress = unwrap(
      await api.api.progress.get({ fetch: { signal } }),
      "Playback progress request",
    );
    await rememberOfflineProgress(progress);
    return progress;
  } catch (error: unknown) {
    if (canUseOfflineFallback(error)) {
      return offlineProgressFallback();
    }
    throw error;
  }
}

export interface PlaybackProgressUpdate {
  readonly mediaIdentity?: string;
  readonly rel: string;
  readonly position: number;
  readonly duration: number;
  readonly completed: boolean;
  readonly anilistMediaId?: number;
  readonly episode?: number;
  readonly totalEpisodes?: number | null;
  readonly event?: "completed" | "heartbeat" | "seeked" | "started" | "stopped";
  readonly sessionSeconds?: number;
}

export interface PlaybackWatchedUpdate {
  readonly mediaIdentity?: string;
  readonly rel: string;
  readonly watched: boolean;
  readonly anilistMediaId?: number;
  readonly episode?: number;
  readonly totalEpisodes?: number | null;
  readonly origin?: "episode-menu" | "season-menu" | "series-menu";
}

async function savePlaybackProgressOnline(
  update: PlaybackProgressUpdate,
): Promise<PlaybackProgress> {
  return unwrap(await api.api.progress.put(update), "Saving playback progress");
}

export async function savePlaybackProgress(
  update: PlaybackProgressUpdate,
): Promise<PlaybackProgress> {
  try {
    return await savePlaybackProgressOnline(update);
  } catch (error: unknown) {
    if (canUseOfflineFallback(error)) {
      return saveOfflinePlayback(update);
    }
    throw error;
  }
}

export function syncOfflinePlayback(): Promise<void> {
  return flushOfflinePlayback(savePlaybackProgressOnline);
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
  target?: AniListPlaybackUpdate & Pick<PlaybackWatchedUpdate, "origin" | "mediaIdentity">,
): Promise<PlaybackProgress> {
  return unwrap(
    await api.api.progress.watched.post({ rel, watched, ...target }),
    watched ? "Marking episode watched" : "Marking episode unwatched",
  );
}

export async function setPlaybackWatchedBatch(
  updates: readonly PlaybackWatchedUpdate[],
): Promise<readonly PlaybackProgress[]> {
  const saved: PlaybackProgress[] = [];
  for (const update of updates) {
    // AniList progress is a frontier, so season changes must be applied in episode order.
    // eslint-disable-next-line no-await-in-loop, react-doctor/async-await-in-loop
    saved.push(await setPlaybackWatched(update.rel, update.watched, update));
  }
  return saved;
}

type AniListPlaybackUpdate = Pick<
  PlaybackProgressUpdate,
  "anilistMediaId" | "episode" | "totalEpisodes"
>;
