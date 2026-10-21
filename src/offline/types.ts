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

export interface OfflineChunkMetadata {
  readonly downloadId: string;
  readonly index: number;
  readonly byteLength: number;
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
  readonly completeDownload: (transition: OfflineDownloadTransition) => Promise<OfflineDownload>;
  readonly failDownload: (
    transition: OfflineDownloadFailure,
  ) => Promise<OfflineDownload | null>;
  readonly findDownload: (userId: number, rel: string) => Promise<OfflineDownload | null>;
  readonly getChunk: (downloadId: string, index: number) => Promise<ArrayBuffer | null>;
  readonly listChunkMetadata: (downloadId: string) => Promise<readonly OfflineChunkMetadata[]>;
  readonly listDownloads: (
    userId: number,
    completedOnly?: boolean,
  ) => Promise<readonly OfflineDownload[]>;
  readonly putDownload: (download: OfflineDownload) => Promise<void>;
  readonly putProfile: (profile: OfflineProfile) => Promise<void>;
  /** Read-modify-write of one profile inside a single transaction, so concurrent updates can't overwrite each other. */
  readonly mergeProfile: (userId: number, merge: (existing: OfflineProfile | null) => OfflineProfile | null) => Promise<void>;
  readonly getProfile: (userId: number) => Promise<OfflineProfile | null>;
  readonly getLatestProfile: () => Promise<OfflineProfile | null>;
  readonly setActiveProfile: (userId: number | null) => Promise<void>;
  readonly removeDownload: (downloadId: string) => Promise<void>;
  readonly removeChunks: (downloadId: string, indexes: readonly number[]) => Promise<void>;
  readonly writeChunk: (write: OfflineChunkWrite) => Promise<OfflineDownload>;
}

export interface OfflineDownloadTransition {
  readonly downloadId: string;
  readonly sourceUrl: string;
  readonly totalBytes: number;
  readonly updatedAt: number;
}

export interface OfflineDownloadFailure extends OfflineDownloadTransition {
  readonly error: string;
  readonly state: "failed" | "paused";
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
  readonly sourceVersion: string | null;
  readonly updatedAt: number;
}
