import { expectedOfflineChunkBytes, inspectOfflineChunks, offlineChunkCount } from "./chunks.ts";
import {
  OFFLINE_CHUNK_INVENTORY_STORE,
  OFFLINE_CHUNK_STORE,
  OFFLINE_DOWNLOAD_STORE,
  requestResult,
  transactionDone,
} from "./databaseSchema.ts";
import type {
  OfflineChunkMetadata,
  OfflineChunkWrite,
  OfflineDownload,
  OfflineDownloadFailure,
  OfflineDownloadTransition,
} from "./types.ts";

interface CommitStores {
  readonly chunks: IDBObjectStore;
  readonly downloads: IDBObjectStore;
  readonly inventory: IDBObjectStore;
}

function commitTransaction(database: IDBDatabase): IDBTransaction {
  return database.transaction(
    [OFFLINE_DOWNLOAD_STORE, OFFLINE_CHUNK_STORE, OFFLINE_CHUNK_INVENTORY_STORE],
    "readwrite",
  );
}

function commitStores(transaction: IDBTransaction): CommitStores {
  return {
    chunks: transaction.objectStore(OFFLINE_CHUNK_STORE),
    downloads: transaction.objectStore(OFFLINE_DOWNLOAD_STORE),
    inventory: transaction.objectStore(OFFLINE_CHUNK_INVENTORY_STORE),
  };
}

function matchingIdentity(
  download: OfflineDownload,
  transition: OfflineDownloadTransition,
): boolean {
  return download.id === transition.downloadId && download.sourceUrl === transition.sourceUrl &&
    download.totalBytes === transition.totalBytes;
}

function validateChunkWrite(current: OfflineDownload, write: OfflineChunkWrite): void {
  const validIndex = Number.isSafeInteger(write.index) && write.index >= 0 &&
    write.index < offlineChunkCount(current.totalBytes);
  const expectedBytes = expectedOfflineChunkBytes(write.index, current.totalBytes);
  if (!validIndex || write.bytes.byteLength !== expectedBytes) {
    throw new Error("Offline media chunk does not match its assigned range");
  }
  if (current.sourceVersion !== null && current.sourceVersion !== write.sourceVersion) {
    throw new Error("Offline media changed during the download");
  }
}

async function buildChunkCommit(
  stores: CommitStores,
  write: OfflineChunkWrite,
): Promise<OfflineDownload> {
  const currentRequest = requestResult(stores.downloads.get(write.downloadId)) as
    Promise<OfflineDownload | undefined>;
  const previousRequest = requestResult(stores.inventory.get([write.downloadId, write.index])) as
    Promise<OfflineChunkMetadata | undefined>;
  const [current, previous] = await Promise.all([currentRequest, previousRequest]);
  if (current === undefined) {
    throw new Error("Offline download record is missing");
  }
  validateChunkWrite(current, write);
  return {
    ...current,
    sourceVersion: current.sourceVersion ?? write.sourceVersion,
    downloadedBytes: current.downloadedBytes - (previous?.byteLength ?? 0) +
      write.bytes.byteLength,
    updatedAt: write.updatedAt,
  };
}

function persistChunk(stores: CommitStores, write: OfflineChunkWrite, next: OfflineDownload): void {
  const key = { downloadId: write.downloadId, index: write.index };
  stores.chunks.put({ ...key, bytes: write.bytes });
  stores.inventory.put({ ...key, byteLength: write.bytes.byteLength });
  stores.downloads.put(next);
}

export async function commitOfflineChunk(
  database: IDBDatabase,
  write: OfflineChunkWrite,
): Promise<OfflineDownload> {
  const transaction = commitTransaction(database);
  const done = transactionDone(transaction);
  const stores = commitStores(transaction);
  const next = await buildChunkCommit(stores, write);
  persistChunk(stores, write, next);
  await done;
  return next;
}

function completedRecord(
  current: OfflineDownload | undefined,
  metadata: readonly OfflineChunkMetadata[],
  transition: OfflineDownloadTransition,
): OfflineDownload {
  if (current === undefined || !matchingIdentity(current, transition)) {
    throw new Error("Offline download was removed or replaced before completion");
  }
  const inventory = inspectOfflineChunks(metadata, current.totalBytes);
  if (inventory.missing.length > 0 || inventory.invalid.length > 0) {
    throw new Error("Offline media download is missing stored chunks");
  }
  return {
    ...current,
    state: "complete",
    downloadedBytes: inventory.downloadedBytes,
    updatedAt: transition.updatedAt,
    error: null,
  };
}

export async function completeStoredDownload(
  database: IDBDatabase,
  transition: OfflineDownloadTransition,
): Promise<OfflineDownload> {
  const transaction = commitTransaction(database);
  const done = transactionDone(transaction);
  const stores = commitStores(transaction);
  const currentRequest = requestResult(stores.downloads.get(transition.downloadId)) as
    Promise<OfflineDownload | undefined>;
  const metadataRequest = requestResult(
    stores.inventory.index("by-download").getAll(transition.downloadId),
  ) as Promise<OfflineChunkMetadata[]>;
  const [current, metadata] = await Promise.all([currentRequest, metadataRequest]);
  const complete = completedRecord(current, metadata, transition);
  stores.downloads.put(complete);
  await done;
  return complete;
}

export async function failStoredDownload(
  database: IDBDatabase,
  transition: OfflineDownloadFailure,
): Promise<OfflineDownload | null> {
  const transaction = database.transaction(OFFLINE_DOWNLOAD_STORE, "readwrite");
  const done = transactionDone(transaction);
  const downloads = transaction.objectStore(OFFLINE_DOWNLOAD_STORE);
  const failed = await failureRecord(downloads, transition);
  if (failed === null) {
    await done;
    return null;
  }
  downloads.put(failed);
  await done;
  return failed;
}

async function failureRecord(
  downloads: IDBObjectStore,
  transition: OfflineDownloadFailure,
): Promise<OfflineDownload | null> {
  const current = await requestResult(downloads.get(transition.downloadId)) as
    OfflineDownload | undefined;
  return failedRecord(current, transition);
}

function failedRecord(
  current: OfflineDownload | undefined,
  transition: OfflineDownloadFailure,
): OfflineDownload | null {
  return current === undefined || !matchingIdentity(current, transition)
    ? null
    : {
      ...current,
      state: transition.state,
      updatedAt: transition.updatedAt,
      error: transition.error,
    };
}
