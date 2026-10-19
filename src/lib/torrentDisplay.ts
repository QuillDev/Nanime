import { formatDuration, formatSize } from "../format.ts";
import type { AniListMedia, ShowMetadata, TorrentStatus } from "../types.ts";
import { mediaTitle } from "./anilist.ts";
import { showMetadataKey } from "./library.ts";

export type TorrentTone = "active" | "done" | "problem" | "waiting";

const STATES = new Map<string, readonly [string, TorrentTone]>(Object.entries({
  allocating: ["Allocating", "waiting"],
  checkingDL: ["Checking", "waiting"],
  checkingResumeData: ["Checking", "waiting"],
  checkingUP: ["Checking", "waiting"],
  downloading: ["Downloading", "active"],
  error: ["Error", "problem"],
  forcedDL: ["Downloading", "active"],
  metaDL: ["Fetching metadata", "waiting"],
  missingFiles: ["Missing files", "problem"],
  moving: ["Moving", "waiting"],
  pausedDL: ["Paused", "waiting"],
  queuedDL: ["Queued", "waiting"],
  stalledDL: ["Stalled", "problem"],
} as const));

export interface TorrentDisplay {
  readonly title: string;
  readonly release: string | null;
  readonly cover: string | null;
  readonly status: string;
  readonly tone: TorrentTone;
  readonly size: string;
  readonly detail: string;
}

function torrentMedia(torrent: TorrentStatus, metadata: ShowMetadata): AniListMedia | undefined {
  return torrent.showFolder === null ? undefined : metadata[showMetadataKey(torrent.showFolder)];
}

function etaLabel(torrent: TorrentStatus): string {
  const eta = torrent.eta > 0 && torrent.eta < 8_640_000 ? `${formatDuration(torrent.eta)} left` : "";
  const speed = torrent.downloadSpeed > 0 ? `${formatSize(torrent.downloadSpeed)}/s` : "";
  return [speed, eta].filter((part) => part !== "").join(" · ");
}

/** Presents a qBittorrent job as its show: library title and cover when known, the release name as a tag. */
export function torrentDisplay(torrent: TorrentStatus, metadata: ShowMetadata): TorrentDisplay {
  const media = torrentMedia(torrent, metadata);
  const title = media === undefined ? torrent.showFolder ?? torrent.name : mediaTitle(media);
  const complete = torrent.progress >= 1;
  const [status, tone] = complete ? ["Done", "done" as const] : STATES.get(torrent.state) ?? [torrent.state, "waiting" as const];
  return {
    title,
    release: title === torrent.name ? null : torrent.name,
    cover: media?.coverImage.large ?? media?.coverImage.extraLarge ?? null,
    status,
    tone,
    size: complete ? formatSize(torrent.size) : `${formatSize(torrent.completed)} of ${formatSize(torrent.size)}`,
    detail: complete ? "Seeding" : etaLabel(torrent),
  };
}
