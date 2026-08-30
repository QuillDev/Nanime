import type { OfflineMediaChunk } from "./types.ts";

export const OFFLINE_DATABASE_NAME = "nanime-offline-v1";
export const OFFLINE_DATABASE_VERSION = 3;
export const OFFLINE_DOWNLOAD_STORE = "downloads";
export const OFFLINE_CHUNK_STORE = "mediaChunks";
export const OFFLINE_CHUNK_INVENTORY_STORE = "mediaChunkInventory";
export const OFFLINE_PROFILE_STORE = "profiles";

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  const result = Promise.withResolvers<T>();
  request.addEventListener("success", () => result.resolve(request.result), { once: true });
  request.addEventListener("error", () => {
    result.reject(request.error ?? new Error("IndexedDB request failed"));
  }, { once: true });
  return result.promise;
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  const result = Promise.withResolvers<void>();
  transaction.addEventListener("complete", () => result.resolve(), { once: true });
  transaction.addEventListener("abort", () => {
    result.reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  }, { once: true });
  transaction.addEventListener("error", () => {
    result.reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  }, { once: true });
  return result.promise;
}

function createStores(database: IDBDatabase): void {
  createPrimaryStores(database);
  if (!database.objectStoreNames.contains(OFFLINE_CHUNK_INVENTORY_STORE)) {
    const inventory = database.createObjectStore(OFFLINE_CHUNK_INVENTORY_STORE, {
      keyPath: ["downloadId", "index"],
    });
    inventory.createIndex("by-download", "downloadId");
  }
}

function createPrimaryStores(database: IDBDatabase): void {
  if (!database.objectStoreNames.contains(OFFLINE_DOWNLOAD_STORE)) {
    const downloads = database.createObjectStore(OFFLINE_DOWNLOAD_STORE, { keyPath: "id" });
    downloads.createIndex("by-user-rel", ["userId", "rel"], { unique: true });
    downloads.createIndex("by-user-state", ["userId", "state"]);
  }
  if (!database.objectStoreNames.contains(OFFLINE_CHUNK_STORE)) {
    const chunks = database.createObjectStore(OFFLINE_CHUNK_STORE, {
      keyPath: ["downloadId", "index"],
    });
    chunks.createIndex("by-download", "downloadId");
  }
  if (!database.objectStoreNames.contains(OFFLINE_PROFILE_STORE)) {
    database.createObjectStore(OFFLINE_PROFILE_STORE, { keyPath: "user.id" });
  }
}

function migrateChunkInventory(transaction: IDBTransaction): void {
  const chunks = transaction.objectStore(OFFLINE_CHUNK_STORE);
  const inventory = transaction.objectStore(OFFLINE_CHUNK_INVENTORY_STORE);
  const request = chunks.openCursor();
  request.addEventListener("success", () => {
    const cursor = request.result;
    if (cursor === null) {
      return;
    }
    const chunk = cursor.value as OfflineMediaChunk;
    inventory.put({
      downloadId: chunk.downloadId,
      index: chunk.index,
      byteLength: chunk.bytes.byteLength,
    });
    cursor.continue();
  });
}

function upgradeOfflineDatabase(request: IDBOpenDBRequest, event: IDBVersionChangeEvent): void {
  createStores(request.result);
  if (event.oldVersion > 0 && event.oldVersion < 3 && request.transaction !== null) {
    migrateChunkInventory(request.transaction);
  }
}

function closeOnVersionChange(database: IDBDatabase): IDBDatabase {
  database.addEventListener("versionchange", () => database.close());
  return database;
}

export async function openOfflineDatabase(
  factory: IDBFactory = indexedDB,
): Promise<IDBDatabase> {
  const request = factory.open(OFFLINE_DATABASE_NAME, OFFLINE_DATABASE_VERSION);
  const blocked = Promise.withResolvers<never>();
  let wasBlocked = false;
  request.addEventListener("upgradeneeded", (event) => {
    upgradeOfflineDatabase(request, event as IDBVersionChangeEvent);
  });
  request.addEventListener("blocked", () => {
    wasBlocked = true;
    blocked.reject(new Error("Offline storage upgrade is blocked by another tab"));
  }, { once: true });
  request.addEventListener("success", () => {
    if (wasBlocked) {
      request.result.close();
    }
  });
  const database = await Promise.race([requestResult(request), blocked.promise]);
  return closeOnVersionChange(database);
}
