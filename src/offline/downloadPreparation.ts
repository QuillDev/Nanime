import { inspectOfflineChunks } from "./chunks.ts";
import type {
  DownloadOfflineMediaOptions,
  OfflineDownload,
  OfflineMediaSource,
} from "./types.ts";

export interface PreparedDownload {
  readonly download: OfflineDownload;
  readonly missing: readonly number[];
}

export function validOfflineSource(source: OfflineMediaSource): boolean {
  return Number.isSafeInteger(source.size) && source.size > 0 && source.mediaUrl !== "" &&
    source.contentType.startsWith("video/");
}

function reusableDownload(
  existing: OfflineDownload | null,
  source: OfflineMediaSource,
): boolean {
  return existing !== null && existing.totalBytes === source.size &&
    existing.sourceUrl === source.mediaUrl &&
    (source.version === null || existing.sourceVersion === source.version);
}

function createDownload(
  options: DownloadOfflineMediaOptions,
  existing: OfflineDownload | null,
  downloadedBytes: number,
): OfflineDownload {
  const now = (options.now ?? Date.now)();
  const { entry, source, userId } = options;
  const reusable = reusableDownload(existing, source);
  return {
    ...entry,
    id: reusable && existing !== null ? existing.id : crypto.randomUUID(),
    userId,
    state: "downloading",
    sourceUrl: source.mediaUrl,
    sourceVersion: reusable && existing !== null ? existing.sourceVersion : source.version,
    contentType: source.contentType,
    totalBytes: source.size,
    downloadedBytes,
    duration: source.duration ?? existing?.duration ?? null,
    createdAt: reusable && existing !== null ? existing.createdAt : now,
    updatedAt: now,
    error: null,
  };
}

async function reusableChunkMetadata(
  options: DownloadOfflineMediaOptions,
  previous: OfflineDownload | null,
  reusable: boolean,
) {
  return reusable && previous !== null
    ? await options.store.listChunkMetadata(previous.id)
    : [];
}

async function savePreparedDownload(
  options: DownloadOfflineMediaOptions,
  download: OfflineDownload,
): Promise<void> {
  await options.store.putDownload(download);
  options.onProgress?.(download);
}

export async function prepareOfflineDownload(
  options: DownloadOfflineMediaOptions,
  previous: OfflineDownload | null,
): Promise<PreparedDownload> {
  const reusable = reusableDownload(previous, options.source);
  if (previous !== null && !reusable) {
    await options.store.removeDownload(previous.id);
  }
  const metadata = await reusableChunkMetadata(options, previous, reusable);
  const inventory = inspectOfflineChunks(metadata, options.source.size);
  if (reusable && previous !== null && inventory.invalid.length > 0) {
    await options.store.removeChunks(previous.id, inventory.invalid);
  }
  const download = createDownload(options, previous, inventory.downloadedBytes);
  await savePreparedDownload(options, download);
  return { download, missing: inventory.missing };
}
