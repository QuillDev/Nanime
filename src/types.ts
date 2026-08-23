import type {
  AuthUser,
  PlaybackProgress,
  TranscodePreset,
  TvmazeMatch,
} from "../shared/types.ts";

export type {
  AniListListEntry,
  AuthUser,
  LibraryStatus,
  MediaEntry,
  MetadataRefreshStatus,
  NyaaSearchResult,
  NyaaSort,
  NyaaSortOrder,
  PlaybackProgress,
  TorrentStatus,
  TranscodePreset,
  TvmazeEpisode,
} from "../shared/types.ts";

export interface SubtitleTrack {
  readonly index: number;
  readonly codec: string;
  readonly language: string;
  readonly label: string;
  readonly sizeBytes: number | null;
}

export interface AudioTrack {
  readonly index: number;
  readonly codec: string;
  readonly language: string;
  readonly label: string;
  readonly channels: number;
  readonly isDefault: boolean;
  readonly sizeBytes: number | null;
}

export interface TrackPruneOperation {
  readonly path: string;
  readonly audioIndices: readonly number[];
  readonly subtitleIndices: readonly number[];
}

interface AniListTitle {
  readonly english: string | null;
  readonly romaji: string;
  readonly native: string | null;
}

interface AniListCoverImage {
  readonly extraLarge: string | null;
  readonly large: string | null;
  readonly color: string | null;
}

interface AniListEpisode {
  readonly title: string;
  readonly thumbnail: string | null;
  readonly site: string;
}

export type MetadataProvider = "anilist" | "jikan";

export interface AniListMedia {
  readonly provider: MetadataProvider;
  readonly id: number;
  readonly anilistId: number | null;
  readonly idMal: number | null;
  readonly title: AniListTitle;
  readonly description: string | null;
  readonly coverImage: AniListCoverImage;
  readonly bannerImage: string | null;
  readonly episodes: number | null;
  readonly duration: number | null;
  readonly season: string | null;
  readonly seasonYear: number | null;
  readonly format: string | null;
  readonly status: string | null;
  readonly genres: readonly string[];
  readonly averageScore: number | null;
  readonly siteUrl: string;
  readonly streamingEpisodes: readonly AniListEpisode[];
  readonly tvmaze?: TvmazeMatch | null;
  readonly tvmazeCheckedAt?: number;
}

export type ShowMetadata = Readonly<Record<string, AniListMedia>>;

export interface AniListPlaybackTarget {
  readonly mediaId: number;
  readonly episode: number;
  readonly totalEpisodes: number | null;
}

export type PlaybackProgressMap = Readonly<Record<string, PlaybackProgress>>;

export interface AniListAuthConfig {
  readonly enabled: boolean;
}

export interface AniListAccountStatus {
  readonly configured: boolean;
  readonly connected: boolean;
  readonly account: {
    readonly id: number;
    readonly name: string;
    readonly avatarUrl: string | null;
    readonly expiresAt: number;
  } | null;
}

export type AniListWatchStatus =
  | "NONE"
  | "CURRENT"
  | "PLANNING"
  | "COMPLETED"
  | "DROPPED"
  | "PAUSED"
  | "REPEATING";

export interface ProvisionedUser extends AuthUser {
  readonly passwordSet: boolean;
}

export interface StorageStatus {
  readonly totalBytes: number;
  readonly availableBytes: number;
}

export interface TranscodeJob {
  readonly id: string;
  readonly sourcePath: string;
  readonly preset: TranscodePreset;
  readonly status: "queued" | "processing" | "complete" | "failed" | "cancelled";
  readonly inputSize: number;
  readonly outputSize: number | null;
  readonly progress: number;
  readonly speed: number;
  readonly startedAt: number | null;
  readonly error: string | null;
  readonly originalDeleted: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface MediaScan {
  readonly sourcePath: string;
  readonly status: "queued" | "scanning" | "complete" | "failed";
  readonly fileSize: number;
  readonly duration: number | null;
  readonly formatName: string | null;
  readonly videoCodec: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly audioBytes: number;
  readonly subtitleBytes: number;
  readonly scannedAt: number | null;
  readonly error: string | null;
  readonly updatedAt: number;
}
