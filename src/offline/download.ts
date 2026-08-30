import type {
  DownloadOfflineMediaOptions,
  OfflineDownload,
} from "./types.ts";
import { transferMissingChunks } from "./downloadTransfer.ts";
import {
  prepareOfflineDownload,
  type PreparedDownload,
  validOfflineSource,
} from "./downloadPreparation.ts";

export { OFFLINE_MEDIA_CHUNK_BYTES } from "./chunks.ts";
export { OFFLINE_MEDIA_PARALLEL_REQUESTS } from "./pool.ts";

interface ActiveDownload {
  readonly controller: AbortController;
  readonly fingerprint: string;
  readonly promise: Promise<OfflineDownload>;
  readonly progressListeners: Set<NonNullable<DownloadOfflineMediaOptions["onProgress"]>>;
}

const activeDownloads = new Map<string, ActiveDownload>();

function failureState(error: unknown): "failed" | "paused" {
  return error instanceof DOMException && error.name === "AbortError" ? "paused" : "failed";
}

async function completeDownload(
  options: DownloadOfflineMediaOptions,
  download: OfflineDownload,
): Promise<OfflineDownload> {
  const complete = await options.store.completeDownload({
    downloadId: download.id,
    sourceUrl: download.sourceUrl,
    totalBytes: download.totalBytes,
    updatedAt: (options.now ?? Date.now)(),
  });
  options.onProgress?.(complete);
  return complete;
}

async function recordFailure(
  options: DownloadOfflineMediaOptions,
  fallback: OfflineDownload,
  error: unknown,
): Promise<void> {
  const failed = await options.store.failDownload({
    downloadId: fallback.id,
    sourceUrl: fallback.sourceUrl,
    totalBytes: fallback.totalBytes,
    state: failureState(error),
    updatedAt: (options.now ?? Date.now)(),
    error: error instanceof Error ? error.message : "Offline media download failed",
  });
  if (failed !== null) {
    options.onProgress?.(failed);
  }
}

async function transferDownload(
  options: DownloadOfflineMediaOptions,
  prepared: PreparedDownload,
): Promise<OfflineDownload> {
  try {
    await transferMissingChunks(options, prepared.download, prepared.missing);
    return await completeDownload(options, prepared.download);
  } catch (error: unknown) {
    await recordFailure(options, prepared.download, error);
    throw error;
  }
}

async function performDownload(
  options: DownloadOfflineMediaOptions,
): Promise<OfflineDownload> {
  if (!validOfflineSource(options.source)) {
    throw new Error("Offline media source is invalid");
  }
  const previous = await options.store.findDownload(options.userId, options.entry.rel);
  const prepared = await prepareOfflineDownload(options, previous);
  return transferDownload(options, prepared);
}

function activeDownloadKey(options: DownloadOfflineMediaOptions): string {
  return `${String(options.userId)}\0${options.entry.rel}`;
}

async function clearActiveDownload(
  key: string,
  active: ActiveDownload,
): Promise<void> {
  try {
    await active.promise;
  } catch {
    // The caller owns the result; this observer only releases coordination state.
  } finally {
    if (activeDownloads.get(key) === active) {
      activeDownloads.delete(key);
    }
  }
}

function sourceFingerprint(options: DownloadOfflineMediaOptions): string {
  const { mediaUrl, size, version } = options.source;
  return `${mediaUrl}\0${String(size)}\0${version ?? ""}`;
}

async function continueAfterActiveDownload(
  active: ActiveDownload,
  options: DownloadOfflineMediaOptions,
): Promise<OfflineDownload> {
  try {
    await waitForActiveDownload(active.promise, options.signal);
  } catch {
    if (options.signal?.aborted === true) {
      throw new DOMException("The offline download was cancelled", "AbortError");
    }
    // A replacement generation can proceed after the old attempt settles.
  }
  if (options.signal?.aborted === true) {
    throw new DOMException("The offline download was cancelled", "AbortError");
  }
  return downloadOfflineMedia(options);
}

async function waitForActiveDownload(
  active: Promise<OfflineDownload>,
  signal: AbortSignal | undefined,
): Promise<OfflineDownload> {
  if (signal === undefined) {
    return active;
  }
  const aborted = Promise.withResolvers<never>();
  const abort = () => aborted.reject(
    new DOMException("The offline download was cancelled", "AbortError"));
  if (signal.aborted) {
    abort();
  } else {
    signal.addEventListener("abort", abort, { once: true });
  }
  try {
    return await Promise.race([active, aborted.promise]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function publishActiveProgress(
  listeners: ReadonlySet<NonNullable<DownloadOfflineMediaOptions["onProgress"]>>,
  download: OfflineDownload,
): void {
  for (const listener of listeners) {
    notifyProgressListener(listener, download);
  }
}

function notifyProgressListener(
  listener: NonNullable<DownloadOfflineMediaOptions["onProgress"]>,
  download: OfflineDownload,
): void {
  try {
    listener(download);
  } catch {
    // A view callback cannot compromise the shared durable transfer.
  }
}

async function subscribeToActiveDownload(
  active: ActiveDownload,
  options: DownloadOfflineMediaOptions,
): Promise<OfflineDownload> {
  const unsubscribe = subscribeToProgressAndCancel(active, options);
  try {
    return await active.promise;
  } finally {
    unsubscribe();
  }
}

function subscribeToProgressAndCancel(
  active: ActiveDownload,
  options: DownloadOfflineMediaOptions,
): () => void {
  const listener = options.onProgress;
  const cancel = () => active.controller.abort();
  if (listener !== undefined) {
    active.progressListeners.add(listener);
  }
  if (options.signal?.aborted === true) {
    cancel();
  } else {
    options.signal?.addEventListener("abort", cancel, { once: true });
  }
  return () => {
    options.signal?.removeEventListener("abort", cancel);
    if (listener !== undefined) {
      active.progressListeners.delete(listener);
    }
  };
}

function startActiveDownload(options: DownloadOfflineMediaOptions): ActiveDownload {
  const controller = new AbortController();
  const progressListeners = new Set<NonNullable<DownloadOfflineMediaOptions["onProgress"]>>();
  const coordinated = {
    ...options,
    signal: controller.signal,
    onProgress: (download: OfflineDownload) => publishActiveProgress(progressListeners, download),
  };
  return {
    controller,
    fingerprint: sourceFingerprint(options),
    progressListeners,
    promise: performDownload(coordinated),
  };
}

export function downloadOfflineMedia(
  options: DownloadOfflineMediaOptions,
): Promise<OfflineDownload> {
  if (options.signal?.aborted === true) {
    return Promise.reject(new DOMException("The offline download was cancelled", "AbortError"));
  }
  const key = activeDownloadKey(options);
  const active = activeDownloads.get(key);
  if (active !== undefined) {
    return active.fingerprint === sourceFingerprint(options)
      ? subscribeToActiveDownload(active, options)
      : continueAfterActiveDownload(active, options);
  }
  const next = startActiveDownload(options);
  activeDownloads.set(key, next);
  void clearActiveDownload(key, next);
  return subscribeToActiveDownload(next, options);
}
