import { QueryClient } from "@tanstack/react-query";
import type { LibraryFileItem, LibraryFilesSnapshot } from "../../shared/libraryFiles.ts";
import type {
  DownloadState, DownloadStatus, LibraryStatus, MediaScan, MetadataRefreshStatus, ProvisionedUser, StorageStatus, TranscodeJob,
} from "../types.ts";
import { seedFind } from "./findFixtures.ts";
import { homeEntries, homeMetadata, homeShows } from "./homeFixtures.ts";

/** Fictional admin data for `/preview/?state=admin-<tab>`, over the home preview library. */
const NOW = Date.now();
const entries = homeEntries.map((entry, index) => ({ ...entry, size: (1.1 + (index % 5) * 0.2) * 1024 ** 3 }));
// One folder with no metadata, so the bell lists a show to match.
const UNMATCHED = "[Fansub] Lantern Ferry Club (Season 02 pt.2) [WEBRip 1080p AV1] (Dual Audio)";
const unmatched = [1, 2].map((episode) => ({
  rel: `${UNMATCHED}/Lantern Ferry Club - 0${String(episode)}.mkv`, name: `Lantern Ferry Club - 0${String(episode)}.mkv`,
  folder: UNMATCHED, size: 1.2 * 1024 ** 3, direct: false,
}));
const libraryEntries = [...entries, ...unmatched];
const MINUTE = 60_000;
const GB = 1024 ** 3;

function showName(index: number): string {
  return homeShows[index]?.name ?? "Untitled";
}

function download(index: number, progress: number, state: DownloadState): DownloadStatus {
  const name = `[Fansub] ${showName(index)} - Batch [1080p]`;
  return {
    id: `torrent:${String(index).repeat(40)}`, kind: "torrent", name, showFolder: showName(index), progress,
    downloadSpeed: state === "downloading" ? 6_400_000 : 0, eta: state === "downloading" ? 1260 : 0,
    completed: Math.round(progress * 14 * GB), size: 14 * GB, state, addedOn: (NOW - index * 90 * MINUTE) / 1000, error: null,
  };
}

/** A direct download of one episode, as a source plugin queues them. */
function episodeDownload(index: number, number: number, state: DownloadState): DownloadStatus {
  const error = state === "failed" ? "The source answered 403" : null;
  const progress = state === "queued" ? 0 : 0.35 + number * 0.1;
  return {
    id: `episode-${String(index)}-${String(number)}`, kind: "file", name: `${showName(index)} - 0${String(number)}.mp4`, showFolder: showName(index),
    progress, state, downloadSpeed: state === "downloading" ? 3_100_000 : 0, eta: state === "downloading" ? 240 : 0,
    completed: Math.round(progress * 0.9 * GB), size: Math.round(0.9 * GB), addedOn: (NOW - number * MINUTE) / 1000, error,
  };
}

const downloads = {
  downloads: [
    episodeDownload(3, 1, "downloading"),
    episodeDownload(3, 2, "paused"),
    episodeDownload(3, 3, "failed"),
    episodeDownload(3, 4, "queued"),
    download(2, 0.42, "downloading"),
    download(4, 0.08, "stalled"),
  ],
  torrentError: null,
};

const users: readonly ProvisionedUser[] = [
  { id: 1, username: "preview", isAdmin: true, passwordSet: true },
  { id: 2, username: "mika", isAdmin: false, passwordSet: true },
  { id: 3, username: "ren", isAdmin: false, passwordSet: false },
];

function job(index: number, status: TranscodeJob["status"], progress: number): TranscodeJob {
  const rel = homeShows[0]?.entries[index]?.rel ?? "missing.mkv";
  return {
    id: `job${String(index)}`, sourcePath: rel, preset: "compatibility", status, inputSize: 1.4 * GB,
    outputSize: status === "complete" ? 0.6 * GB : null, progress, speed: status === "processing" ? 0.35 : 0,
    startedAt: status === "queued" ? null : NOW - 20 * MINUTE, error: status === "failed" ? "ffmpeg exited with code 1" : null,
    originalDeleted: false, createdAt: NOW - 60 * MINUTE, updatedAt: NOW,
  };
}

const transcodes: readonly TranscodeJob[] = [
  job(5, "processing", 0.37),
  job(6, "queued", 0),
  job(7, "queued", 0),
  job(4, "complete", 1),
  job(3, "failed", 0.12),
];

const scans: readonly MediaScan[] = homeEntries.slice(0, 40).map((entry, index) => ({
  sourcePath: entry.rel, status: "complete" as const, fileSize: (1.1 + (index % 5) * 0.2) * GB, duration: 1440,
  formatName: "matroska,webm", videoCodec: index % 3 === 0 ? "hevc" : "h264", width: 1920, height: 1080,
  audioBytes: 90_000_000, subtitleBytes: 400_000, scannedAt: NOW - 5 * MINUTE, error: null, updatedAt: NOW,
}));

function libraryFiles(): LibraryFilesSnapshot {
  const items: LibraryFileItem[] = [];
  for (const show of homeShows) {
    const folderId = `folder:${show.name}`;
    items.push({ id: folderId, parentId: null, path: show.name, name: show.name, kind: "folder", media: null, size: null, modifiedAt: NOW - 3 * 86_400_000, lock: null });
    for (const entry of show.entries) {
      items.push({
        id: `file:${entry.rel}`, parentId: folderId, path: entry.rel, name: entry.name, kind: "file", media: "video",
        size: 1.3 * GB, modifiedAt: entry.addedAt ?? NOW, lock: null,
      });
    }
  }
  return { items, torrentOwnership: "available", generatedAt: NOW };
}

/** Agent keys: one in use, one never used. Paths are this fictional host's. */
export const agentMcp = { command: "/opt/nanime/runtime/bun", args: ["run", "/opt/nanime/server/mcp.ts"] };
const agentKeys = {
  keys: [
    { id: 2, name: "Hermes on the media box", createdBy: "preview", createdAt: NOW - 3 * 86_400_000, lastUsedAt: NOW - 4 * MINUTE },
    { id: 1, name: "Laptop", createdBy: "preview", createdAt: NOW - 20 * 86_400_000, lastUsedAt: null },
  ],
  mcp: agentMcp,
};
export const createdAgentKey = { key: "nanime_q8W3vXr2Lm0Zt7Ya5Kp1Hc9Ue4Nd6Bf0Gs2Jo8Ri3Tw", agentKey: { id: 3, name: "Hermes", createdBy: "preview", createdAt: NOW, lastUsedAt: null } };

const storage: StorageStatus = { totalBytes: 1800 * GB, availableBytes: 612 * GB };
const libraryStatus: LibraryStatus = { entryCount: homeEntries.length, lastScannedAt: NOW - 12 * MINUTE, scanning: false };
const metadataRefresh: MetadataRefreshStatus = {
  state: "complete", total: homeShows.length, completed: homeShows.length, failed: 0,
  startedAt: NOW - 2 * 86_400_000, completedAt: NOW - 2 * 86_400_000 + 40_000, error: null,
};

/** A query cache holding the admin pages' data; API calls stay stubbed. */
export function adminQueryClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
  const seeded: readonly (readonly [string, unknown])[] = [
    ["library", libraryEntries], ["show-metadata", homeMetadata], ["downloads", downloads], ["users", users],
    ["transcodes", transcodes], ["media-scans", scans], ["library-files", libraryFiles()],
    ["storage-status", storage], ["library-status", libraryStatus], ["metadata-refresh", metadataRefresh], ["agent-keys", agentKeys],
  ];
  for (const [key, data] of seeded) {
    client.setQueryData([key], data);
  }
  seedFind(client);
  return client;
}
