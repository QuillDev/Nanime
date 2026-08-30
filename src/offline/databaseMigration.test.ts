import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import {
  OFFLINE_CHUNK_INVENTORY_STORE,
  OFFLINE_CHUNK_STORE,
  OFFLINE_DATABASE_NAME,
  OFFLINE_DOWNLOAD_STORE,
  OFFLINE_PROFILE_STORE,
  openOfflineDatabase,
} from "./databaseSchema.ts";
import { commitOfflineChunk } from "./databaseMutations.ts";
import { IndexedDbOfflineStore } from "./database.ts";

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  const result = Promise.withResolvers<T>();
  request.addEventListener("success", () => result.resolve(request.result), { once: true });
  request.addEventListener("error", () => result.reject(request.error), { once: true });
  return result.promise;
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  const result = Promise.withResolvers<void>();
  transaction.addEventListener("complete", () => result.resolve(), { once: true });
  transaction.addEventListener("error", () => result.reject(transaction.error), { once: true });
  return result.promise;
}

async function versionTwoDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(OFFLINE_DATABASE_NAME, 2);
  request.addEventListener("upgradeneeded", () => {
    const downloads = request.result.createObjectStore(OFFLINE_DOWNLOAD_STORE, { keyPath: "id" });
    downloads.createIndex("by-user-rel", ["userId", "rel"], { unique: true });
    downloads.createIndex("by-user-state", ["userId", "state"]);
    const chunks = request.result.createObjectStore(
      OFFLINE_CHUNK_STORE, { keyPath: ["downloadId", "index"] });
    chunks.createIndex("by-download", "downloadId");
    request.result.createObjectStore(OFFLINE_PROFILE_STORE, { keyPath: "user.id" });
  });
  return await requestValue(request);
}

async function seedLegacyChunk(database: IDBDatabase): Promise<void> {
  const transaction = database.transaction(OFFLINE_CHUNK_STORE, "readwrite");
  const done = transactionComplete(transaction);
  transaction.objectStore(OFFLINE_CHUNK_STORE).put({
    downloadId: "legacy-download",
    index: 2,
    bytes: new Uint8Array([1, 2, 3]).buffer,
  });
  await done;
}

async function inventory(database: IDBDatabase) {
  const transaction = database.transaction(OFFLINE_CHUNK_INVENTORY_STORE, "readonly");
  return await requestValue(
    transaction.objectStore(OFFLINE_CHUNK_INVENTORY_STORE).getAll());
}

async function seedDownload(database: IDBDatabase): Promise<void> {
  const transaction = database.transaction(OFFLINE_DOWNLOAD_STORE, "readwrite");
  const done = transactionComplete(transaction);
  transaction.objectStore(OFFLINE_DOWNLOAD_STORE).put({
    id: "validated-download",
    userId: 7,
    rel: "Example/Episode.mp4",
    sourceUrl: "/media",
    sourceVersion: '"v1"',
    totalBytes: 3,
    downloadedBytes: 0,
  });
  await done;
}

describe("offline IndexedDB migrations", () => {
  test("backfills a lightweight inventory when upgrading version two chunks", async () => {
    const factory = new IDBFactory();
    const legacy = await versionTwoDatabase(factory);
    await seedLegacyChunk(legacy);
    legacy.close();

    const upgraded = await openOfflineDatabase(factory);
    expect(upgraded.version).toBe(3);
    expect(await inventory(upgraded)).toEqual([{
      downloadId: "legacy-download",
      index: 2,
      byteLength: 3,
    }]);
    upgraded.close();
  });

  test("reports a blocked upgrade and succeeds after the old tab closes", async () => {
    const factory = new IDBFactory();
    const legacy = await versionTwoDatabase(factory);
    const store = new IndexedDbOfflineStore(factory);
    await expect(store.listDownloads(7)).rejects.toThrow("blocked by another tab");
    legacy.close();
    await expect(store.listDownloads(7)).resolves.toEqual([]);
  });

  test("rejects malformed chunks and missing pinned validators at the storage boundary", async () => {
    const database = await openOfflineDatabase(new IDBFactory());
    await seedDownload(database);
    const base = {
      downloadId: "validated-download",
      index: 0,
      updatedAt: 2,
    };
    await expect(commitOfflineChunk(database, {
      ...base, bytes: new Uint8Array(2).buffer, sourceVersion: '"v1"',
    })).rejects.toThrow("assigned range");
    await expect(commitOfflineChunk(database, {
      ...base, bytes: new Uint8Array(3).buffer, sourceVersion: null,
    })).rejects.toThrow("changed during the download");
    database.close();
  });
});
