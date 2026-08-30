import { isOfflineDownloadAvailable } from "./database.ts";
import type {
  DownloadOfflineMediaOptions,
  OfflineDownload,
  OfflineDownloadStore,
  OfflineMediaSource,
} from "./types.ts";
import {
  fetchOfflineMediaParts,
  offlineMediaPartVersion,
  OFFLINE_MEDIA_CHUNK_BYTES,
  type OfflineMediaPart,
} from "./ranges.ts";

export { OFFLINE_MEDIA_CHUNK_BYTES, OFFLINE_MEDIA_PARALLEL_REQUESTS } from "./ranges.ts";

function validSource(source: OfflineMediaSource): boolean {
  return Number.isSafeInteger(source.size) && source.size > 0 && source.mediaUrl !== "" &&
    source.contentType.startsWith("video/");
}

function createDownload(
  options: DownloadOfflineMediaOptions,
  existing: OfflineDownload | null,
): OfflineDownload {
  const now = (options.now ?? Date.now)();
  const { entry, source, userId } = options;
  const reusable = existing !== null && existing.totalBytes === source.size &&
    existing.sourceUrl === source.mediaUrl && existing.sourceVersion === source.version;
  return {
    ...entry,
    id: reusable ? existing.id : crypto.randomUUID(),
    userId,
    state: "downloading",
    sourceUrl: source.mediaUrl,
    sourceVersion: source.version,
    contentType: source.contentType,
    totalBytes: source.size,
    downloadedBytes: reusable ? existing.downloadedBytes : 0,
    duration: source.duration ?? existing?.duration ?? null,
    createdAt: reusable ? existing.createdAt : now,
    updatedAt: now,
    error: null,
  };
}

function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(left.byteLength + right.byteLength);
  combined.set(left);
  combined.set(right, left.byteLength);
  return combined;
}

function storedBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

interface PersistContext {
  readonly now: () => number;
  readonly onProgress: DownloadOfflineMediaOptions["onProgress"];
  readonly store: OfflineDownloadStore;
}

interface PendingWrite {
  readonly chunkIndex: number;
  readonly current: OfflineDownload;
  readonly firstChunkExistingBytes: number;
  readonly firstChunkIndex: number;
  readonly pending: Uint8Array;
}

async function writePendingChunks(
  context: PersistContext,
  write: PendingWrite,
): Promise<OfflineDownload> {
  if (write.pending.byteLength === 0) {
    return write.current;
  }
  const length = Math.min(OFFLINE_MEDIA_CHUNK_BYTES, write.pending.byteLength);
  const chunk = write.pending.slice(0, length);
  const replacedBytes = write.chunkIndex === write.firstChunkIndex
    ? write.firstChunkExistingBytes
    : 0;
  const next: OfflineDownload = {
    ...write.current,
    downloadedBytes: write.current.downloadedBytes + length - replacedBytes,
    updatedAt: context.now(),
  };
  await context.store.writeChunk({
    downloadId: next.id,
    index: write.chunkIndex,
    bytes: storedBuffer(chunk),
    download: next,
  });
  context.onProgress?.(next);
  return writePendingChunks(context, {
    chunkIndex: write.chunkIndex + 1,
    current: next,
    firstChunkExistingBytes: write.firstChunkExistingBytes,
    firstChunkIndex: write.firstChunkIndex,
    pending: write.pending.slice(length),
  });
}

async function persistBytes(
  context: PersistContext,
  download: OfflineDownload,
  bytes: Uint8Array,
): Promise<OfflineDownload> {
  const index = Math.floor(download.downloadedBytes / OFFLINE_MEDIA_CHUNK_BYTES);
  const withinChunk = download.downloadedBytes % OFFLINE_MEDIA_CHUNK_BYTES;
  const stored = withinChunk === 0
    ? new ArrayBuffer(0)
    : await context.store.getChunk(download.id, index) ?? new ArrayBuffer(0);
  const existing = new Uint8Array(stored);
  if (existing.byteLength !== withinChunk) {
    throw new Error("Offline media chunk is inconsistent with its download record");
  }
  return writePendingChunks(context, {
    chunkIndex: index,
    current: download,
    firstChunkExistingBytes: existing.byteLength,
    firstChunkIndex: index,
    pending: appendBytes(existing, bytes),
  });
}

async function persistMediaParts(
  context: PersistContext,
  download: OfflineDownload,
  parts: readonly OfflineMediaPart[],
): Promise<OfflineDownload> {
  const [part, ...remaining] = parts;
  if (part === undefined) {
    return download;
  }
  const next = await persistBytes(context, download, part.bytes);
  return persistMediaParts(context, next, remaining);
}

async function consumeParallelRanges(
  options: DownloadOfflineMediaOptions,
  download: OfflineDownload,
): Promise<OfflineDownload> {
  if (download.downloadedBytes === download.totalBytes) {
    return download;
  }
  const request = options.fetch ?? fetch;
  const parts = await fetchOfflineMediaParts({ download, request, signal: options.signal });
  const context: PersistContext = {
    store: options.store,
    now: options.now ?? Date.now,
    onProgress: options.onProgress,
  };
  const versioned = {
    ...download,
    sourceVersion: offlineMediaPartVersion(parts, download.sourceVersion),
  };
  const next = await persistMediaParts(context, versioned, parts);
  return consumeParallelRanges(options, next);
}

function failureState(error: unknown): "failed" | "paused" {
  return error instanceof DOMException && error.name === "AbortError" ? "paused" : "failed";
}

function sameCompleteDownload(
  download: OfflineDownload | null,
  source: OfflineMediaSource,
): download is OfflineDownload {
  return download !== null && isOfflineDownloadAvailable(download) &&
    download.sourceUrl === source.mediaUrl && download.sourceVersion === source.version &&
    download.totalBytes === source.size;
}

async function prepareDownload(
  options: DownloadOfflineMediaOptions,
  previous: OfflineDownload | null,
): Promise<OfflineDownload> {
  const download = createDownload(options, previous);
  if (previous !== null && previous.id !== download.id) {
    await options.store.removeDownload(previous.id);
  }
  await options.store.putDownload(download);
  options.onProgress?.(download);
  return download;
}

async function completeDownload(
  options: DownloadOfflineMediaOptions,
  download: OfflineDownload,
): Promise<OfflineDownload> {
  const complete: OfflineDownload = {
    ...download,
    state: "complete",
    updatedAt: (options.now ?? Date.now)(),
    error: null,
  };
  await options.store.putDownload(complete);
  options.onProgress?.(complete);
  return complete;
}

async function recordFailure(
  options: DownloadOfflineMediaOptions,
  fallback: OfflineDownload,
  error: unknown,
): Promise<void> {
  const current = await options.store.findDownload(options.userId, options.entry.rel) ?? fallback;
  const failed: OfflineDownload = {
    ...current,
    state: failureState(error),
    updatedAt: (options.now ?? Date.now)(),
    error: error instanceof Error ? error.message : "Offline media download failed",
  };
  await options.store.putDownload(failed);
  options.onProgress?.(failed);
}

async function transferDownload(
  options: DownloadOfflineMediaOptions,
  download: OfflineDownload,
): Promise<OfflineDownload> {
  try {
    const consumed = await consumeParallelRanges(options, download);
    return await completeDownload(options, consumed);
  } catch (error: unknown) {
    await recordFailure(options, download, error);
    throw error;
  }
}

export async function downloadOfflineMedia(
  options: DownloadOfflineMediaOptions,
): Promise<OfflineDownload> {
  if (!validSource(options.source)) {
    throw new Error("Offline media source is invalid");
  }
  const previous = await options.store.findDownload(options.userId, options.entry.rel);
  if (sameCompleteDownload(previous, options.source)) {
    return previous;
  }
  const download = await prepareDownload(options, previous);
  return transferDownload(options, download);
}
