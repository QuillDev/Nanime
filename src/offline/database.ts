import type {
  OfflineDownload,
  OfflineDownloadStore,
  OfflineChunkWrite,
  OfflineMediaChunk,
  OfflineProfile,
} from "./types.ts";

export const OFFLINE_DATABASE_NAME = "nanime-offline-v1";
export const OFFLINE_DATABASE_VERSION = 2;
export const OFFLINE_DOWNLOAD_STORE = "downloads";
export const OFFLINE_CHUNK_STORE = "mediaChunks";
export const OFFLINE_PROFILE_STORE = "profiles";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  const result = Promise.withResolvers<T>();
  request.addEventListener("success", () => result.resolve(request.result), { once: true });
  request.addEventListener("error", () => result.reject(request.error ?? new Error("IndexedDB request failed")), {
    once: true,
  });
  return result.promise;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  const result = Promise.withResolvers<void>();
  transaction.addEventListener("complete", () => result.resolve(), { once: true });
  transaction.addEventListener("abort", () => result.reject(transaction.error ?? new Error("IndexedDB transaction aborted")), { once: true });
  transaction.addEventListener("error", () => result.reject(transaction.error ?? new Error("IndexedDB transaction failed")), { once: true });
  return result.promise;
}

function createSchema(database: IDBDatabase): void {
  const downloads = database.createObjectStore(OFFLINE_DOWNLOAD_STORE, { keyPath: "id" });
  downloads.createIndex("by-user-rel", ["userId", "rel"], { unique: true });
  downloads.createIndex("by-user-state", ["userId", "state"]);
  const chunks = database.createObjectStore(OFFLINE_CHUNK_STORE, {
    keyPath: ["downloadId", "index"],
  });
  chunks.createIndex("by-download", "downloadId");
  database.createObjectStore(OFFLINE_PROFILE_STORE, { keyPath: "user.id" });
}

export function openOfflineDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  const request = factory.open(OFFLINE_DATABASE_NAME, OFFLINE_DATABASE_VERSION);
  request.addEventListener("upgradeneeded", (event) => {
    if ((event as IDBVersionChangeEvent).oldVersion === 0) {
      createSchema(request.result);
    }
  });
  return requestResult(request);
}

async function deleteChunkCursor(store: IDBObjectStore, downloadId: string): Promise<void> {
  const index = store.index("by-download");
  const request = index.openKeyCursor(IDBKeyRange.only(downloadId));
  const result = Promise.withResolvers<void>();
  request.addEventListener("error", () => result.reject(request.error ?? new Error("Could not remove offline media chunks")), { once: true });
  request.addEventListener("success", () => {
    const cursor = request.result;
    if (cursor === null) {
      result.resolve();
      return;
    }
    store.delete(cursor.primaryKey);
    cursor.continue();
  });
  await result.promise;
}

export class IndexedDbOfflineStore implements OfflineDownloadStore {
  readonly #database: Promise<IDBDatabase>;

  constructor(factory?: IDBFactory) {
    this.#database = factory === undefined ? openOfflineDatabase() : openOfflineDatabase(factory);
  }

  async findDownload(userId: number, rel: string): Promise<OfflineDownload | null> {
    const database = await this.#database;
    const transaction = database.transaction(OFFLINE_DOWNLOAD_STORE, "readonly");
    const done = transactionDone(transaction);
    const request = transaction.objectStore(OFFLINE_DOWNLOAD_STORE)
      .index("by-user-rel").get([userId, rel]);
    const result = await requestResult(request) as OfflineDownload | undefined;
    await done;
    return result ?? null;
  }

  async getChunk(downloadId: string, index: number): Promise<ArrayBuffer | null> {
    const database = await this.#database;
    const transaction = database.transaction(OFFLINE_CHUNK_STORE, "readonly");
    const done = transactionDone(transaction);
    const request = transaction.objectStore(OFFLINE_CHUNK_STORE).get([downloadId, index]);
    const result = await requestResult(request) as OfflineMediaChunk | undefined;
    await done;
    return result?.bytes ?? null;
  }

  async listDownloads(userId: number, completedOnly = false): Promise<readonly OfflineDownload[]> {
    const database = await this.#database;
    const transaction = database.transaction(OFFLINE_DOWNLOAD_STORE, "readonly");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(OFFLINE_DOWNLOAD_STORE);
    const request = completedOnly
      ? store.index("by-user-state").getAll([userId, "complete"])
      : store.getAll();
    const records = await requestResult(request) as OfflineDownload[];
    await done;
    return records
      .filter((record) => record.userId === userId && (!completedOnly || isOfflineDownloadAvailable(record)))
      .toSorted((left, right) => right.updatedAt - left.updatedAt);
  }

  async putDownload(download: OfflineDownload): Promise<void> {
    const database = await this.#database;
    const transaction = database.transaction(OFFLINE_DOWNLOAD_STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(OFFLINE_DOWNLOAD_STORE).put(download);
    await done;
  }

  async putProfile(profile: OfflineProfile): Promise<void> {
    const database = await this.#database;
    const transaction = database.transaction(OFFLINE_PROFILE_STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(OFFLINE_PROFILE_STORE).put(profile);
    await done;
  }

  async getProfile(userId: number): Promise<OfflineProfile | null> {
    const database = await this.#database;
    const transaction = database.transaction(OFFLINE_PROFILE_STORE, "readonly");
    const done = transactionDone(transaction);
    const result = await requestResult(transaction.objectStore(OFFLINE_PROFILE_STORE).get(userId)) as OfflineProfile | undefined;
    await done;
    return result ?? null;
  }

  async getLatestProfile(): Promise<OfflineProfile | null> {
    const database = await this.#database;
    const transaction = database.transaction(OFFLINE_PROFILE_STORE, "readonly");
    const done = transactionDone(transaction);
    const profiles = await requestResult(
      transaction.objectStore(OFFLINE_PROFILE_STORE).getAll(),
    ) as OfflineProfile[];
    await done;
    return profiles.toSorted((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
  }

  async setActiveProfile(userId: number | null): Promise<void> {
    const database = await this.#database;
    const transaction = database.transaction(OFFLINE_PROFILE_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(OFFLINE_PROFILE_STORE);
    const profiles = await requestResult(store.getAll()) as OfflineProfile[];
    for (const profile of profiles) {
      store.put({ ...profile, active: profile.user.id === userId });
    }
    await done;
  }

  async removeDownload(downloadId: string): Promise<void> {
    const database = await this.#database;
    const transaction = database.transaction(
      [OFFLINE_DOWNLOAD_STORE, OFFLINE_CHUNK_STORE],
      "readwrite",
    );
    const done = transactionDone(transaction);
    transaction.objectStore(OFFLINE_DOWNLOAD_STORE).delete(downloadId);
    await deleteChunkCursor(transaction.objectStore(OFFLINE_CHUNK_STORE), downloadId);
    await done;
  }

  async writeChunk(write: OfflineChunkWrite): Promise<void> {
    const { downloadId, index, bytes, download } = write;
    const database = await this.#database;
    const transaction = database.transaction(
      [OFFLINE_DOWNLOAD_STORE, OFFLINE_CHUNK_STORE],
      "readwrite",
    );
    const done = transactionDone(transaction);
    transaction.objectStore(OFFLINE_CHUNK_STORE).put({ downloadId, index, bytes });
    transaction.objectStore(OFFLINE_DOWNLOAD_STORE).put(download);
    await done;
  }
}

export function isOfflineDownloadAvailable(download: OfflineDownload): boolean {
  return download.state === "complete" && download.totalBytes > 0 &&
    download.downloadedBytes === download.totalBytes;
}

export function offlineMediaUrl(downloadId: string): string {
  return `/offline-download/${encodeURIComponent(downloadId)}/media`;
}
