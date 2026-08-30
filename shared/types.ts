export interface MediaEntry {
  readonly rel: string;
  readonly name: string;
  readonly folder: string;
  readonly size: number;
  readonly direct: boolean;
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

export type LibraryActivityState = MappingActivityState | UploadActivityState;

export interface LibraryActivityEvent {
  readonly id: number;
  readonly actorUserId: number;
  readonly actorUsername: string;
  readonly action: "mapping-updated" | "media-uploaded";
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
}

export interface AniListListEntry {
  readonly id: number;
  readonly mediaId: number;
  readonly status: string;
  readonly progress: number;
  readonly score: number;
}

export interface TorrentStatus {
  readonly hash: string;
  readonly name: string;
  readonly showFolder: string | null;
  readonly progress: number;
  readonly downloadSpeed: number;
  readonly eta: number;
  readonly completed: number;
  readonly size: number;
  readonly state: string;
  readonly addedOn: number;
}

export type TranscodePreset = "space-saver" | "compatibility";

export interface TvmazeEpisode {
  readonly id: number;
  readonly season: number;
  readonly number: number | null;
  readonly type: string;
  readonly title: string;
  readonly summary: string | null;
  readonly airDate: string | null;
  readonly thumbnail: string | null;
}

export interface TvmazeMatch {
  readonly id: number;
  readonly name: string;
  readonly siteUrl: string;
  readonly premiered: string | null;
  readonly episodes: readonly TvmazeEpisode[];
}

export interface NyaaSearchResult {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly size: string;
  readonly seeders: number;
  readonly leechers: number;
  readonly downloads: number;
  readonly publishedAt: string;
  readonly trusted: boolean;
  readonly remake: boolean;
  readonly detailsUrl: string;
  readonly magnet: string;
}

export type NyaaSort = "id" | "size" | "seeders" | "leechers" | "downloads";
export type NyaaSortOrder = "asc" | "desc";
