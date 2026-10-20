import type { PreferredAudioLanguage } from "./audioLanguage.ts";
import type { FileOperationActivityState } from "./libraryFiles.ts";

export interface MediaEntry {
  /** Filesystem occupant identity: stable across managed moves, captured by queued edits. */
  readonly mediaIdentity?: string;
  readonly rel: string;
  readonly name: string;
  readonly folder: string;
  readonly size: number;
  readonly direct: boolean;
  /** When the file landed in the library (its modification time, epoch ms). */
  readonly addedAt?: number;
  /** Device-local service-worker source; absent from server library responses. */
  readonly offlineUrl?: string;
}

export type OfflineMediaStatus = "failed" | "preparing" | "queued" | "ready";

export interface OfflineMediaArtifact {
  readonly id: string;
  readonly path: string;
  readonly status: OfflineMediaStatus;
  readonly progress: number;
  readonly speed: number;
  readonly sourceSizeBytes: number;
  readonly sizeBytes: number | null;
  readonly duration: number;
  readonly mimeType: string;
  readonly mediaUrl: string | null;
  readonly error: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface LibraryStatus {
  readonly entryCount: number;
  readonly lastScannedAt: number | null;
  readonly scanning: boolean;
}

export interface MetadataRefreshStatus {
  readonly state: "complete" | "idle" | "running";
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  readonly error: string | null;
}

export interface PlaybackProgress {
  readonly rel: string;
  readonly position: number;
  readonly duration: number;
  readonly completed: boolean;
  readonly updatedAt: number;
  readonly dismissedAt: number | null;
}

export type PlaybackAuditAction =
  | "completed"
  | "playback-started"
  | "playback-stopped"
  | "restored"
  | "snapshot-imported"
  | "watched"
  | "unwatched";

export type PlaybackAuditOrigin =
  | "episode-menu"
  | "history"
  | "home"
  | "media-library"
  | "migration"
  | "player"
  | "season-menu"
  | "series-menu";

export interface PlaybackAuditEvent {
  readonly id: number;
  readonly userId: number;
  readonly actorUserId: number | null;
  readonly actorUsername: string;
  readonly rel: string;
  readonly action: PlaybackAuditAction;
  readonly origin: PlaybackAuditOrigin;
  readonly previous: PlaybackProgress | null;
  readonly next: PlaybackProgress | null;
  readonly anilistMediaId: number | null;
  readonly episode: number | null;
  readonly totalEpisodes: number | null;
  readonly sessionSeconds: number | null;
  readonly revertsEventId: number | null;
  readonly createdAt: number;
}

export interface UploadActivityState {
  readonly kind: "upload";
  readonly path: string;
  readonly size: number;
}

export interface MappingActivityState {
  readonly kind: "mapping";
  readonly key: string;
  readonly provider: string;
  readonly mediaId: number;
  readonly anilistId: number | null;
  readonly title: string;
}

export type LibraryActivityState =
  | FileOperationActivityState
  | MappingActivityState
  | UploadActivityState;

export type LibraryActivityAction =
  | "files-moved"
  | "files-renamed"
  | "files-reverted"
  | "files-trashed"
  | "folder-created"
  | "mapping-updated"
  | "media-uploaded";

export interface LibraryActivityEvent {
  readonly id: number;
  readonly actorUserId: number;
  readonly actorUsername: string;
  readonly action: LibraryActivityAction;
  readonly subject: string;
  readonly previous: LibraryActivityState | null;
  readonly next: LibraryActivityState;
  readonly createdAt: number;
}

export interface TrickplayReady {
  readonly status: "ready";
  readonly version: string;
  readonly interval: number;
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly frameCount: number;
  readonly sheetCount: number;
}

export interface TrickplayPending {
  readonly status: "generating" | "unavailable";
}

export type TrickplayManifest = TrickplayReady | TrickplayPending;

export interface AuthUser {
  readonly id: number;
  readonly username: string;
  readonly isAdmin: boolean;
  readonly preferredAudioLanguage: PreferredAudioLanguage | null;
}

export interface AniListListEntry {
  readonly id: number;
  readonly mediaId: number;
  readonly status: string;
  readonly progress: number;
  readonly score: number;
}

/** Who fetches a download: qBittorrent for torrents, Nanime itself for direct links. */
export type DownloadKind = "torrent" | "file";

export type DownloadState = "queued" | "downloading" | "paused" | "stalled" | "failed";

/** One unfinished download, whichever backend runs it. */
export interface DownloadStatus {
  /** `torrent:<hash>` for torrents, a UUID for direct downloads. */
  readonly id: string;
  readonly kind: DownloadKind;
  readonly name: string;
  readonly showFolder: string | null;
  readonly state: DownloadState;
  readonly progress: number;
  readonly downloadSpeed: number;
  /** Seconds left, or 0 when unknown. */
  readonly eta: number;
  readonly completed: number;
  /** Total bytes, or 0 when unknown (a stream whose size shows only at the end). */
  readonly size: number;
  /** Unix seconds. */
  readonly addedOn: number;
  readonly error: string | null;
}

/** An admin-created key an agent (the MCP server) signs requests with. */
export interface AgentKey {
  readonly id: number;
  readonly name: string;
  /** The admin it acts as. */
  readonly createdBy: string;
  /** Epoch ms. */
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
}

/** What to download. A season is one torrent, or one file item per episode. */
export type DownloadItem =
  | { readonly kind: "torrent"; readonly magnet: string }
  | {
    readonly kind: "file";
    readonly url: string;
    /** File name in the show folder; HLS streams are saved as `.mp4`. */
    readonly fileName: string;
    readonly headers?: Readonly<Record<string, string>>;
  };

export type TranscodePreset = "space-saver" | "compatibility";

