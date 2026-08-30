import type {
  OfflineChunkMetadata,
  OfflineDownload,
  OfflineDownloadStore,
  OfflineChunkWrite,
  OfflineDownloadFailure,
  OfflineDownloadTransition,
  OfflineMediaChunk,
  OfflineProfile,
} from "./types.ts";
import {
  commitOfflineChunk,
  completeStoredDownload,
  failStoredDownload,
} from "./databaseMutations.ts";
import {
  OFFLINE_CHUNK_INVENTORY_STORE,
  OFFLINE_CHUNK_STORE,
  OFFLINE_DOWNLOAD_STORE,
  OFFLINE_PROFILE_STORE,
  openOfflineDatabase,
  requestResult,
  transactionDone,
} from "./databaseSchema.ts";

export {
  OFFLINE_CHUNK_INVENTORY_STORE,
  OFFLINE_CHUNK_STORE,
  OFFLINE_DATABASE_NAME,
  OFFLINE_DATABASE_VERSION,
  OFFLINE_DOWNLOAD_STORE,
  OFFLINE_PROFILE_STORE,
  openOfflineDatabase,
} from "./databaseSchema.ts";

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
  #database: Promise<IDBDatabase> | null = null;
  readonly #factory: IDBFactory | undefined;
  readonly #observed = new WeakSet<IDBDatabase>();

  constructor(factory?: IDBFactory) {
    this.#factory = factory;
  }

  private async database(): Promise<IDBDatabase> {
    const opening = this.#database ?? (
      this.#factory === undefined
        ? openOfflineDatabase()
        : openOfflineDatabase(this.#factory)
    );
    this.#database = opening;
    try {
      const database = await opening;
      this.observeConnection(database, opening);
      return database;
    } catch (error: unknown) {
      if (this.#database === opening) {
        this.#database = null;
      }
      throw error;
    }
  }

  private observeConnection(database: IDBDatabase, opening: Promise<IDBDatabase>): void {
    if (this.#observed.has(database)) {
      return;
    }
    this.#observed.add(database);
    database.addEventListener("versionchange", () => {
      if (this.#database === opening) {
        this.#database = null;
      }
    });
  }

  async findDownload(userId: number, rel: string): Promise<OfflineDownload | null> {
    const database = await this.database();
    const transaction = database.transaction(OFFLINE_DOWNLOAD_STORE, "readonly");
    const done = transactionDone(transaction);
    const request = transaction.objectStore(OFFLINE_DOWNLOAD_STORE)
      .index("by-user-rel").get([userId, rel]);
    const result = await requestResult(request) as OfflineDownload | undefined;
    await done;
    return result ?? null;
  }

  async completeDownload(transition: OfflineDownloadTransition): Promise<OfflineDownload> {
    return completeStoredDownload(await this.database(), transition);
  }

  async failDownload(transition: OfflineDownloadFailure): Promise<OfflineDownload | null> {
    return failStoredDownload(await this.database(), transition);
  }

  async getChunk(downloadId: string, index: number): Promise<ArrayBuffer | null> {
    const database = await this.database();
    const transaction = database.transaction(OFFLINE_CHUNK_STORE, "readonly");
    const done = transactionDone(transaction);
    const request = transaction.objectStore(OFFLINE_CHUNK_STORE).get([downloadId, index]);
    const result = await requestResult(request) as OfflineMediaChunk | undefined;
    await done;
    return result?.bytes ?? null;
  }

  async listChunkMetadata(downloadId: string): Promise<readonly OfflineChunkMetadata[]> {
    const database = await this.database();
    const transaction = database.transaction(OFFLINE_CHUNK_INVENTORY_STORE, "readonly");
    const done = transactionDone(transaction);
    const request = transaction.objectStore(OFFLINE_CHUNK_INVENTORY_STORE)
      .index("by-download").getAll(downloadId);
    const result = await requestResult(request) as OfflineChunkMetadata[];
    await done;
    return result;
  }

  async listDownloads(userId: number, completedOnly = false): Promise<readonly OfflineDownload[]> {
    const database = await this.database();
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
    const database = await this.database();
    const transaction = database.transaction(OFFLINE_DOWNLOAD_STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(OFFLINE_DOWNLOAD_STORE).put(download);
    await done;
  }

  async putProfile(profile: OfflineProfile): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(OFFLINE_PROFILE_STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(OFFLINE_PROFILE_STORE).put(profile);
    await done;
  }

  async getProfile(userId: number): Promise<OfflineProfile | null> {
    const database = await this.database();
    const transaction = database.transaction(OFFLINE_PROFILE_STORE, "readonly");
    const done = transactionDone(transaction);
    const result = await requestResult(transaction.objectStore(OFFLINE_PROFILE_STORE).get(userId)) as OfflineProfile | undefined;
    await done;
    return result ?? null;
  }

  async getLatestProfile(): Promise<OfflineProfile | null> {
    const database = await this.database();
    const transaction = database.transaction(OFFLINE_PROFILE_STORE, "readonly");
    const done = transactionDone(transaction);
    const profiles = await requestResult(
      transaction.objectStore(OFFLINE_PROFILE_STORE).getAll(),
    ) as OfflineProfile[];
    await done;
    return profiles.toSorted((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
  }

  async setActiveProfile(userId: number | null): Promise<void> {
    const database = await this.database();
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
    const database = await this.database();
    const transaction = database.transaction(
      [OFFLINE_DOWNLOAD_STORE, OFFLINE_CHUNK_STORE, OFFLINE_CHUNK_INVENTORY_STORE],
      "readwrite",
    );
    const done = transactionDone(transaction);
    transaction.objectStore(OFFLINE_DOWNLOAD_STORE).delete(downloadId);
    const chunksRemoved = deleteChunkCursor(
      transaction.objectStore(OFFLINE_CHUNK_STORE), downloadId);
    const inventoryRemoved = deleteChunkCursor(
      transaction.objectStore(OFFLINE_CHUNK_INVENTORY_STORE), downloadId);
    await Promise.all([chunksRemoved, inventoryRemoved]);
    await done;
  }

  async removeChunks(downloadId: string, indexes: readonly number[]): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(
      [OFFLINE_CHUNK_STORE, OFFLINE_CHUNK_INVENTORY_STORE],
      "readwrite",
    );
    const done = transactionDone(transaction);
    for (const index of indexes) {
      transaction.objectStore(OFFLINE_CHUNK_STORE).delete([downloadId, index]);
      transaction.objectStore(OFFLINE_CHUNK_INVENTORY_STORE).delete([downloadId, index]);
    }
    await done;
  }

  async writeChunk(write: OfflineChunkWrite): Promise<OfflineDownload> {
    return commitOfflineChunk(await this.database(), write);
  }
}

export function isOfflineDownloadAvailable(download: OfflineDownload): boolean {
  return download.state === "complete" && download.totalBytes > 0 &&
    download.downloadedBytes === download.totalBytes;
}

export function offlineMediaUrl(downloadId: string): string {
  return `/offline-download/${encodeURIComponent(downloadId)}/media`;
}
