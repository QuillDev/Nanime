import type { DownloadOfflineMediaOptions, OfflineDownload } from "./types.ts";

const PROGRESS_INTERVAL_MS = 100;

export interface OfflineDownloadProgress {
  readonly commit: (download: OfflineDownload, received: number) => void;
  readonly discard: (received: number) => void;
  readonly receive: (received: number) => void;
}

export function createOfflineDownloadProgress(
  initial: OfflineDownload,
  onProgress: DownloadOfflineMediaOptions["onProgress"],
  now: () => number,
): OfflineDownloadProgress {
  let durable = initial;
  let transientBytes = 0;
  let lastPublishedAt = 0;

  function publish(force = false): void {
    const publishedAt = now();
    if (!force && publishedAt - lastPublishedAt < PROGRESS_INTERVAL_MS) {
      return;
    }
    lastPublishedAt = publishedAt;
    onProgress?.({
      ...durable,
      downloadedBytes: Math.min(durable.totalBytes, durable.downloadedBytes + transientBytes),
    });
  }

  return {
    receive(received) {
      transientBytes += received;
      publish();
    },
    discard(received) {
      transientBytes = Math.max(0, transientBytes - received);
      publish(true);
    },
    commit(download, received) {
      durable = download;
      transientBytes = Math.max(0, transientBytes - received);
      publish(true);
    },
  };
}
