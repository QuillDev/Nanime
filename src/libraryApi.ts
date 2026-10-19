import { api, unwrap } from "./api.ts";
import type { MediaEntry, TranscodeJob } from "./types.ts";
import { hevcPlaybackSupported } from "./lib/hevcPlayback.ts";
import { offlineMediaUrl } from "./offline/database.ts";
import {
  canUseOfflineFallback,
  completedOfflineDownloads,
  offlineLibraryFallback,
  rememberOfflineLibrary,
} from "./offline/runtime.ts";

function downloadedEntry(entry: MediaEntry, downloadId: string): MediaEntry {
  return {
    ...entry,
    direct: true,
    offlineUrl: offlineMediaUrl(downloadId),
  };
}

export async function fetchLibrary(signal: AbortSignal): Promise<readonly MediaEntry[]> {
  try {
    const entries = unwrap(await api.api.list.get({ fetch: { signal } }), "Library request");
    await rememberOfflineLibrary(entries);
    const downloads = await completedOfflineDownloads();
    const downloaded = new Map(downloads.map((download) => [download.rel, download]));
    return entries.map((entry) => {
      const local = downloaded.get(entry.rel);
      return local === undefined ? entry : downloadedEntry(entry, local.id);
    });
  } catch (error: unknown) {
    if (canUseOfflineFallback(error)) {
      return offlineLibraryFallback();
    }
    throw error;
  }
}

async function downloadedDuration(rel: string): Promise<number | null> {
  const downloads = await completedOfflineDownloads();
  const download = downloads.find((item) => item.rel === rel);
  return download?.duration ?? null;
}

export async function fetchMediaDuration(rel: string, signal: AbortSignal): Promise<number> {
  try {
    const response = await api.api["media-info"].get({
      query: { path: rel },
      fetch: { signal },
    });
    return unwrap(response, "Media information request").duration;
  } catch (error: unknown) {
    const duration = canUseOfflineFallback(error) ? await downloadedDuration(rel) : null;
    if (duration !== null) {
      return duration;
    }
    throw error;
  }
}

export interface PlaybackReadiness {
  readonly path: string;
  readonly ready: boolean;
  readonly transcode: {
    readonly status: TranscodeJob["status"];
    readonly progress: number;
    readonly remainingSeconds: number | null;
  } | null;
}

export interface PlaybackReadinessBatch {
  /** Stored transcodes the server runs in parallel. */
  readonly workers: number;
  readonly items: readonly PlaybackReadiness[];
}

export async function fetchPlaybackReadiness(paths: readonly string[], signal: AbortSignal): Promise<PlaybackReadinessBatch> {
  const body = { paths: [...paths], hevc: hevcPlaybackSupported() };
  const response = await api.api["playback-readiness"].post(body, { fetch: { signal } });
  return unwrap(response, "Playback readiness request");
}
