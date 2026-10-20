import { api, unwrap } from "./api.ts";
import type { DownloadItem, DownloadStatus } from "./types.ts";

export interface DownloadList {
  readonly downloads: readonly DownloadStatus[];
  /** Set when qBittorrent can't be read; direct downloads are still listed. */
  readonly torrentError: string | null;
}

export async function fetchDownloads(signal: AbortSignal): Promise<DownloadList> {
  return unwrap(
    await api.api.downloads.get({ fetch: { signal } }),
    "Download status request",
  );
}

/** Queues torrents (to qBittorrent) or direct links (fetched by Nanime) into one show folder. */
export async function addDownloads(showFolder: string, items: readonly DownloadItem[]): Promise<void> {
  unwrap(await api.api.downloads.post({ showFolder, items: [...items] }), "Adding downloads");
}

export type DownloadAction = "pause" | "resume" | "remove";

/** Pauses, resumes, or removes one download; `deleteFiles` only matters for torrents. */
export async function controlDownload(id: string, action: DownloadAction, deleteFiles = false): Promise<void> {
  const download = api.api.downloads({ id });
  if (action === "remove") {
    unwrap(await download.cancel.post({ deleteFiles }), "Removing download");
    return;
  }
  unwrap(await (action === "pause" ? download.pause.post() : download.resume.post()), action === "pause" ? "Pausing download" : "Resuming download");
}
