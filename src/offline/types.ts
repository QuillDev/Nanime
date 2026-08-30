import type {
  AuthUser,
  MediaEntry,
  PlaybackProgress,
  ShowMetadata,
} from "../types.ts";

export type OfflineDownloadState = "complete" | "downloading" | "failed" | "paused" | "preparing";

export interface OfflineMediaSource {
  readonly contentType: string;
  readonly duration?: number | undefined;
  readonly mediaUrl: string;
  readonly size: number;
  readonly version: string | null;
}

export type OfflineMediaFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface OfflineDownload extends MediaEntry {
  readonly id: string;
  readonly userId: number;
  readonly state: OfflineDownloadState;
  readonly sourceUrl: string;
  readonly sourceVersion: string | null;
  readonly contentType: string;
  readonly totalBytes: number;
  readonly downloadedBytes: number;
  readonly duration: number | null;
  readonly preparationProgress?: number | undefined;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly error: string | null;
}

export interface OfflineMediaChunk {
  readonly downloadId: string;
  readonly index: number;
  readonly bytes: ArrayBuffer;
}

export interface OfflineProfile {
  readonly user: AuthUser;
  readonly active: boolean;
  readonly library?: readonly MediaEntry[] | undefined;
  readonly metadata?: ShowMetadata | undefined;
  readonly playbackProgress?: readonly PlaybackProgress[] | undefined;
  readonly updatedAt: number;
}

export interface OfflineStorageEstimate {
  readonly availableBytes: number | null;
  readonly persisted: boolean;
  readonly quotaBytes: number | null;
  readonly sufficient: boolean | null;
  readonly usageBytes: number | null;
}

export interface OfflineDownloadStore {
  readonly findDownload: (userId: number, rel: string) => Promise<OfflineDownload | null>;
  readonly getChunk: (downloadId: string, index: number) => Promise<ArrayBuffer | null>;
  readonly listDownloads: (
    userId: number,
    completedOnly?: boolean,
  ) => Promise<readonly OfflineDownload[]>;
  readonly putDownload: (download: OfflineDownload) => Promise<void>;
  readonly putProfile: (profile: OfflineProfile) => Promise<void>;
  readonly getProfile: (userId: number) => Promise<OfflineProfile | null>;
  readonly getLatestProfile: () => Promise<OfflineProfile | null>;
  readonly setActiveProfile: (userId: number | null) => Promise<void>;
  readonly removeDownload: (downloadId: string) => Promise<void>;
  readonly writeChunk: (write: OfflineChunkWrite) => Promise<void>;
}

export interface DownloadOfflineMediaOptions {
  readonly entry: MediaEntry;
  readonly fetch?: OfflineMediaFetcher;
  readonly now?: () => number;
  readonly onProgress?: ((download: OfflineDownload) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly source: OfflineMediaSource;
  readonly store: OfflineDownloadStore;
  readonly userId: number;
}

export interface OfflineChunkWrite {
  readonly downloadId: string;
  readonly index: number;
  readonly bytes: ArrayBuffer;
  readonly download: OfflineDownload;
}
