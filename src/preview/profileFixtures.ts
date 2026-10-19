import { QueryClient } from "@tanstack/react-query";
import type { OfflineDownload } from "../offline/types.ts";
import type {
  AniListAccountStatus, LibraryActivityEvent, PlaybackAuditEvent, PlaybackProgress,
} from "../types.ts";
import { homeEntries, homeMetadata, homeProgress, homeShows } from "./homeFixtures.ts";

/** Fictional profile-page data for `/preview/?state=profile`, over the home preview library. */
const SHOW = 0;
const OTHER = 1;
const NOW = Date.now();
const MINUTE = 60_000;

function ep(show: number, n: number): string {
  return homeShows[show]?.entries[n - 1]?.rel ?? `missing/${String(n)}.mkv`;
}

function progress(position: number, completed = false): PlaybackProgress {
  return { position, duration: 1440, completed, updatedAt: NOW, dismissedAt: null } as PlaybackProgress;
}

interface AuditFixture {
  readonly id: number;
  readonly rel: string;
  readonly action: PlaybackAuditEvent["action"];
  readonly previous: PlaybackProgress | null;
  readonly next: PlaybackProgress | null;
  readonly minutesAgo: number;
  readonly sessionSeconds?: number;
}

function audit({ id, rel, action, previous, next, minutesAgo, sessionSeconds }: AuditFixture): PlaybackAuditEvent {
  return {
    id, userId: 1, actorUserId: 1, actorUsername: "preview", rel, action, origin: "player",
    previous, next, anilistMediaId: null, episode: null, totalEpisodes: 12, sessionSeconds: sessionSeconds ?? null,
    revertsEventId: null, createdAt: NOW - minutesAgo * MINUTE,
  };
}

const profileHistory: readonly PlaybackAuditEvent[] = [
  audit({ id: 9, rel: ep(SHOW, 7), action: "playback-stopped", previous: progress(0), next: progress(612), minutesAgo: 12, sessionSeconds: 612 }),
  audit({ id: 8, rel: ep(SHOW, 6), action: "completed", previous: progress(1210), next: progress(1440, true), minutesAgo: 40, sessionSeconds: 1380 }),
  audit({ id: 7, rel: ep(SHOW, 6), action: "playback-started", previous: progress(0), next: progress(0), minutesAgo: 64 }),
  audit({ id: 6, rel: ep(OTHER, 3), action: "watched", previous: null, next: progress(1440, true), minutesAgo: 180 }),
  audit({ id: 5, rel: ep(SHOW, 5), action: "completed", previous: progress(300), next: progress(1440, true), minutesAgo: 1500, sessionSeconds: 1140 }),
  audit({ id: 4, rel: ep(OTHER, 2), action: "unwatched", previous: progress(1440, true), next: null, minutesAgo: 2900 }),
  audit({ id: 3, rel: ep(OTHER, 2), action: "completed", previous: progress(900), next: progress(1440, true), minutesAgo: 3000, sessionSeconds: 540 }),
  audit({ id: 2, rel: ep(SHOW, 4), action: "completed", previous: progress(0), next: progress(1440, true), minutesAgo: 4400, sessionSeconds: 1440 }),
];

const profileActivity: readonly LibraryActivityEvent[] = [
  {
    id: 3, actorUserId: 1, actorUsername: "preview", action: "media-uploaded", subject: ep(SHOW, 8),
    previous: null, next: { kind: "upload", path: ep(SHOW, 8), size: 1_284_000_000 }, createdAt: NOW - 30 * MINUTE,
  },
  {
    id: 2, actorUserId: 1, actorUsername: "preview", action: "mapping-updated", subject: homeShows[OTHER]?.name ?? "",
    previous: null,
    next: { kind: "mapping", key: "show", provider: "anilist", mediaId: 101, anilistId: 101, title: homeShows[OTHER]?.name ?? "" },
    createdAt: NOW - 400 * MINUTE,
  },
  {
    id: 1, actorUserId: 1, actorUsername: "preview", action: "media-uploaded", subject: ep(OTHER, 4),
    previous: null, next: { kind: "upload", path: ep(OTHER, 4), size: 980_000_000 }, createdAt: NOW - 2000 * MINUTE,
  },
];

const anilistAvatar = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><defs><linearGradient id='g'><stop stop-color='#f472b6'/><stop offset='1' stop-color='#6366f1'/></linearGradient></defs><rect width='64' height='64' fill='url(#g)'/></svg>",
)}`;

const profileAniList: AniListAccountStatus = {
  configured: true,
  connected: true,
  account: { id: 1, name: "lanternfan", avatarUrl: anilistAvatar, expiresAt: NOW + 1e10 },
};

function download(n: number, state: OfflineDownload["state"], downloadedBytes: number): OfflineDownload {
  const rel = ep(SHOW, n);
  return {
    id: rel, userId: 1, rel, name: rel.split("/").at(-1) ?? rel, folder: rel.split("/")[0] ?? "", size: 820_000_000,
    direct: true, state, sourceUrl: "", sourceVersion: null, contentType: "video/mp4",
    totalBytes: 820_000_000, downloadedBytes, duration: 1440, createdAt: NOW, updatedAt: NOW, error: state === "failed" ? "Network connection lost" : null,
  };
}

const profileDownloads: readonly OfflineDownload[] = [
  download(7, "downloading", 310_000_000),
  download(5, "complete", 820_000_000),
  download(6, "complete", 820_000_000),
  download(4, "failed", 120_000_000),
];

/** A query cache holding the profile page's data; API calls stay stubbed. */
export function profileQueryClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
  client.setQueryData(["library"], homeEntries);
  client.setQueryData(["show-metadata"], homeMetadata);
  client.setQueryData(["playback-progress"], homeProgress("watching"));
  client.setQueryData(["playback-history"], profileHistory);
  client.setQueryData(["library-activity"], profileActivity);
  client.setQueryData(["anilist-account"], profileAniList);
  client.setQueryData(["offline-downloads"], profileDownloads);
  client.setQueryData(["offline-storage"], { availableBytes: 41_000_000_000, persisted: true });
  return client;
}
