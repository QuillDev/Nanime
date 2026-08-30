import type { DownloadOfflineMediaOptions, OfflineDownload } from "./types.ts";
import { OFFLINE_MEDIA_PARALLEL_REQUESTS, runInOfflineMediaPool } from "./pool.ts";
import {
  fetchOfflineMediaPart,
  type OfflineMediaPart,
  RetryableOfflineMediaError,
} from "./ranges.ts";
import {
  createOfflineDownloadProgress,
  type OfflineDownloadProgress,
} from "./downloadProgress.ts";

const OFFLINE_CHUNK_ATTEMPTS = 3;

interface TransferChunkOptions {
  readonly attempt: number;
  readonly download: OfflineDownload;
  readonly index: number;
  readonly options: DownloadOfflineMediaOptions;
  readonly progress: OfflineDownloadProgress;
  readonly signal: AbortSignal;
}

interface WorkerState {
  failure: unknown;
  nextIndex: number;
}

interface WorkerOptions {
  readonly controller: AbortController;
  readonly download: OfflineDownload;
  readonly missing: readonly number[];
  readonly options: DownloadOfflineMediaOptions;
  readonly progress: OfflineDownloadProgress;
  readonly state: WorkerState;
}

function linkedController(signal: AbortSignal | undefined) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted === true) {
    abort();
  } else {
    signal?.addEventListener("abort", abort, { once: true });
  }
  return {
    controller,
    unlink: () => signal?.removeEventListener("abort", abort),
  };
}

function storedBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function transferChunk(transfer: TransferChunkOptions): Promise<void> {
  try {
    await runInOfflineMediaPool(() => transferChunkAttempt(transfer), transfer.signal);
  } catch (error: unknown) {
    if (!retryableTransfer(error, transfer.signal) || transfer.attempt >= OFFLINE_CHUNK_ATTEMPTS) {
      throw error;
    }
    await retryDelay(100 * (2 ** (transfer.attempt - 1)), transfer.signal);
    await transferChunk({ ...transfer, attempt: transfer.attempt + 1 });
  }
}

async function transferChunkAttempt(transfer: TransferChunkOptions): Promise<void> {
  const { download, index, options, progress, signal } = transfer;
  let received = 0;
  try {
    const part = await fetchOfflineMediaPart({
      download,
      index,
      request: options.fetch ?? fetch,
      signal,
      onBytes(bytes) {
        received += bytes;
        progress.receive(bytes);
      },
    });
    await commitTransferredChunk(transfer, part, received);
  } catch (error: unknown) {
    progress.discard(received);
    throw error;
  }
}

async function commitTransferredChunk(
  transfer: TransferChunkOptions,
  part: OfflineMediaPart,
  received: number,
): Promise<void> {
  const { download, index, options, progress, signal } = transfer;
  if (signal.aborted) {
    throw new DOMException("The offline download was cancelled", "AbortError");
  }
  const next = await options.store.writeChunk({
    downloadId: download.id,
    index,
    bytes: storedBuffer(part.bytes),
    sourceVersion: part.version,
    updatedAt: (options.now ?? Date.now)(),
  });
  progress.commit(next, received);
}

function retryableTransfer(error: unknown, signal: AbortSignal): boolean {
  return !signal.aborted &&
    (error instanceof RetryableOfflineMediaError || error instanceof TypeError);
}

function retryDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  const result = Promise.withResolvers<void>();
  const timeout = setTimeout(result.resolve, milliseconds);
  const abort = () => {
    clearTimeout(timeout);
    result.reject(new DOMException("The offline download was cancelled", "AbortError"));
  };
  signal.addEventListener("abort", abort, { once: true });
  void removeRetryAbortListener(result.promise, signal, abort);
  return result.promise;
}

async function removeRetryAbortListener(
  delay: Promise<void>,
  signal: AbortSignal,
  abort: () => void,
): Promise<void> {
  try {
    await delay;
  } catch {
    // The transfer observes the rejection; this observer only removes the listener.
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function claimChunk(worker: WorkerOptions): number | undefined {
  const index = worker.missing[worker.state.nextIndex];
  worker.state.nextIndex += 1;
  return index;
}

async function runWorker(worker: WorkerOptions): Promise<void> {
  if (worker.controller.signal.aborted) {
    return;
  }
  const index = claimChunk(worker);
  if (index === undefined) {
    return;
  }
  try {
    await transferAndContinue(worker, index);
  } catch (error: unknown) {
    worker.state.failure ??= error;
    worker.controller.abort();
  }
}

async function transferAndContinue(worker: WorkerOptions, index: number): Promise<void> {
  await transferChunk({
    options: worker.options,
    download: worker.download,
    index,
    attempt: 1,
    progress: worker.progress,
    signal: worker.controller.signal,
  });
  await runWorker(worker);
}

function workerTasks(worker: WorkerOptions): readonly Promise<void>[] {
  const count = Math.min(OFFLINE_MEDIA_PARALLEL_REQUESTS, worker.missing.length);
  return Array.from({ length: count }, () => runWorker(worker));
}

export async function transferMissingChunks(
  options: DownloadOfflineMediaOptions,
  download: OfflineDownload,
  missing: readonly number[],
): Promise<void> {
  const { controller, unlink } = linkedController(options.signal);
  const state: WorkerState = { failure: null, nextIndex: 0 };
  const progress = createOfflineDownloadProgress(
    download, options.onProgress, options.now ?? Date.now);
  try {
    await Promise.all(workerTasks({ options, download, missing, progress, controller, state }));
  } finally {
    unlink();
  }
  if (state.failure !== null) {
    throw state.failure;
  }
  if (options.signal?.aborted === true) {
    throw new DOMException("The offline download was cancelled", "AbortError");
  }
}
