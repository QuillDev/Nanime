import { formatDuration, formatSize } from "../format.ts";
import type { AniListMedia, DownloadState, DownloadStatus, ShowMetadata } from "../types.ts";
import { mediaTitle } from "./anilist.ts";
import { showMetadataKey } from "./library.ts";
import { artSources } from "./art.ts";

export type DownloadTone = "active" | "problem" | "waiting";

const STATES = {
  downloading: ["Downloading", "active"],
  failed: ["Failed", "problem"],
  paused: ["Paused", "waiting"],
  queued: ["Queued", "waiting"],
  stalled: ["Stalled", "problem"],
} as const satisfies Record<DownloadState, readonly [string, DownloadTone]>;

export interface DownloadDisplay {
  readonly title: string;
  readonly release: string | null;
  readonly cover: string | null;
  readonly status: string;
  readonly tone: DownloadTone;
  readonly size: string;
  readonly detail: string;
}

function downloadMedia(download: DownloadStatus, metadata: ShowMetadata): AniListMedia | undefined {
  return download.showFolder === null ? undefined : metadata[showMetadataKey(download.showFolder)];
}

function etaLabel(download: DownloadStatus): string {
  const eta = download.eta > 0 ? `${formatDuration(download.eta)} left` : "";
  const speed = download.downloadSpeed > 0 ? `${formatSize(download.downloadSpeed)}/s` : "";
  return [speed, eta].filter((part) => part !== "").join(" · ");
}

function sizeLabel(download: DownloadStatus): string {
  return download.size > 0 ? `${formatSize(download.completed)} of ${formatSize(download.size)}` : formatSize(download.completed);
}

function coverArt(media: AniListMedia | undefined): string | null {
  const cover = media?.coverImage.large ?? media?.coverImage.extraLarge ?? null;
  return cover === null ? null : artSources(cover, "cover").src;
}

/** Presents a download as its show: library title and cover when known, the release or file name as a tag. */
export function downloadDisplay(download: DownloadStatus, metadata: ShowMetadata): DownloadDisplay {
  const media = downloadMedia(download, metadata);
  const title = media === undefined ? download.showFolder ?? download.name : mediaTitle(media);
  const [status, tone] = STATES[download.state];
  return {
    title,
    release: title === download.name ? null : download.name,
    cover: coverArt(media),
    status,
    tone,
    size: sizeLabel(download),
    detail: download.error ?? etaLabel(download),
  };
}
