// Keep this schema in lockstep with src/offline/database.ts. The worker cannot
// import application modules because it is installed as a classic worker.
const NANIME_OFFLINE_DATABASE = "nanime-offline-v1";
const NANIME_OFFLINE_DATABASE_VERSION = 3;
const NANIME_DOWNLOAD_STORE = "downloads";
const NANIME_MEDIA_CHUNK_STORE = "mediaChunks";
const NANIME_MEDIA_CHUNK_INVENTORY_STORE = "mediaChunkInventory";
const NANIME_PROFILE_STORE = "profiles";
const NANIME_MEDIA_CHUNK_SIZE = 4 * 1024 * 1024;

function nanimeRequestResult(request) {
  const result = Promise.withResolvers();
  request.addEventListener("success", () => result.resolve(request.result), { once: true });
  request.addEventListener("error", () => result.reject(request.error ?? new Error("IndexedDB request failed")), { once: true });
  return result.promise;
}

function nanimeEnsureOfflineStores(database) {
  nanimeEnsurePrimaryStores(database);
  if (!database.objectStoreNames.contains(NANIME_MEDIA_CHUNK_INVENTORY_STORE)) {
    const inventory = database.createObjectStore(
      NANIME_MEDIA_CHUNK_INVENTORY_STORE,
      { keyPath: ["downloadId", "index"] },
    );
    inventory.createIndex("by-download", "downloadId");
  }
}

function nanimeEnsurePrimaryStores(database) {
  if (!database.objectStoreNames.contains(NANIME_DOWNLOAD_STORE)) {
    const downloads = database.createObjectStore(NANIME_DOWNLOAD_STORE, { keyPath: "id" });
    downloads.createIndex("by-user-rel", ["userId", "rel"], { unique: true });
    downloads.createIndex("by-user-state", ["userId", "state"]);
  }
  if (!database.objectStoreNames.contains(NANIME_MEDIA_CHUNK_STORE)) {
    const chunks = database.createObjectStore(
      NANIME_MEDIA_CHUNK_STORE,
      { keyPath: ["downloadId", "index"] },
    );
    chunks.createIndex("by-download", "downloadId");
  }
  if (!database.objectStoreNames.contains(NANIME_PROFILE_STORE)) {
    database.createObjectStore(NANIME_PROFILE_STORE, { keyPath: "user.id" });
  }
}

function nanimeMigrateChunkInventory(transaction) {
  const chunks = transaction.objectStore(NANIME_MEDIA_CHUNK_STORE);
  const inventory = transaction.objectStore(NANIME_MEDIA_CHUNK_INVENTORY_STORE);
  const request = chunks.openCursor();
  request.addEventListener("success", () => {
    const cursor = request.result;
    if (cursor === null) {
      return;
    }
    const chunk = cursor.value;
    inventory.put({
      downloadId: chunk.downloadId,
      index: chunk.index,
      byteLength: chunk.bytes.byteLength,
    });
    cursor.continue();
  });
}

async function nanimeOpenOfflineDatabase(indexedDb) {
  const request = indexedDb.open(NANIME_OFFLINE_DATABASE, NANIME_OFFLINE_DATABASE_VERSION);
  const blocked = Promise.withResolvers();
  let wasBlocked = false;
  request.addEventListener("upgradeneeded", (event) => {
    nanimeEnsureOfflineStores(request.result);
    if (event.oldVersion > 0 && event.oldVersion < 3 && request.transaction !== null) {
      nanimeMigrateChunkInventory(request.transaction);
    }
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
  const database = await Promise.race([nanimeRequestResult(request), blocked.promise]);
  database.addEventListener("versionchange", () => database.close());
  return database;
}

async function nanimeDatabaseValue(database, storeName, key) {
  const transaction = database.transaction(storeName, "readonly");
  return await nanimeRequestResult(transaction.objectStore(storeName).get(key));
}

async function nanimeChunkInventory(database, downloadId) {
  const transaction = database.transaction(NANIME_MEDIA_CHUNK_INVENTORY_STORE, "readonly");
  const index = transaction.objectStore(NANIME_MEDIA_CHUNK_INVENTORY_STORE)
    .index("by-download");
  return await nanimeRequestResult(index.getAll(downloadId));
}

function nanimeCloseStream(state) {
  if (!state.closed) {
    state.closed = true;
    state.onClose();
  }
}

function nanimeChunkBytes(chunk, range, chunkSize) {
  if (chunk === undefined || !(chunk.bytes instanceof ArrayBuffer)) {
    throw new Error(`Offline media chunk ${String(range.index)} is missing`);
  }
  const chunkStart = range.index * chunkSize;
  const sliceStart = range.start - chunkStart;
  const sliceEnd = Math.min(chunk.bytes.byteLength, range.end - chunkStart);
  if (sliceEnd <= sliceStart) {
    throw new Error(`Offline media chunk ${String(range.index)} is incomplete`);
  }
  return new Uint8Array(chunk.bytes, sliceStart, sliceEnd - sliceStart);
}

function nanimeCloseCompletedStream(state, controller) {
  if (state.position < state.end) {
    return false;
  }
  nanimeCloseStream(state);
  controller.close();
  return true;
}

async function nanimeNextStoredBytes(state) {
  const index = Math.floor(state.position / state.chunkSize);
  const chunk = await state.getChunk(state.downloadId, index);
  return nanimeChunkBytes(
    chunk,
    { index, start: state.position, end: state.end },
    state.chunkSize,
  );
}

async function nanimePullStoredMedia(state, controller) {
  if (nanimeCloseCompletedStream(state, controller)) {
    return;
  }
  try {
    const bytes = await nanimeNextStoredBytes(state);
    state.position += bytes.byteLength;
    controller.enqueue(bytes);
  } catch (error) {
    nanimeCloseStream(state);
    throw error;
  }
}

function nanimeStoredMediaStream(options) {
  const state = { ...options, position: options.start, closed: false };
  function closeSource() {
    nanimeCloseStream(state);
  }
  return new ReadableStream({
    pull: async (controller) => await nanimePullStoredMedia(state, controller),
    cancel() {
      closeSource();
    },
  });
}

function nanimeChunkStream(database, options) {
  return nanimeStoredMediaStream({
    ...options,
    chunkSize: NANIME_MEDIA_CHUNK_SIZE,
    getChunk: async (id, index) => await nanimeDatabaseValue(
      database,
      NANIME_MEDIA_CHUNK_STORE,
      [id, index],
    ),
    onClose: () => database.close(),
  });
}

function nanimeCompleteDownload(download) {
  return download !== undefined &&
    download.state === "complete" &&
    Number.isSafeInteger(download.totalBytes) &&
    download.totalBytes > 0 &&
    download.downloadedBytes === download.totalBytes;
}

function nanimeCompleteInventory(download, inventory) {
  const expectedCount = Math.ceil(download.totalBytes / NANIME_MEDIA_CHUNK_SIZE);
  if (inventory.length !== expectedCount) {
    return false;
  }
  return inventory.every((chunk, index) => {
    const start = index * NANIME_MEDIA_CHUNK_SIZE;
    const expected = Math.min(NANIME_MEDIA_CHUNK_SIZE, download.totalBytes - start);
    return chunk.index === index && chunk.byteLength === expected;
  });
}

async function nanimeDownloadIsActive(database, download) {
  const profile = await nanimeDatabaseValue(database, NANIME_PROFILE_STORE, download.userId);
  return profile !== undefined && profile.active === true;
}

function nanimeOfflineMedia(database, download, downloadId) {
  return {
    contentType: download.contentType,
    size: download.totalBytes,
    close: () => database.close(),
    read(start, end) {
      return nanimeChunkStream(database, { downloadId, start, end });
    },
  };
}

function nanimeUnavailableMedia(database) {
  database.close();
  return null;
}

async function nanimeLoadOfflineMedia(downloadId) {
  if (typeof indexedDB === "undefined") {
    return null;
  }
  const database = await nanimeOpenOfflineDatabase(indexedDB);
  const download = await nanimeDatabaseValue(database, NANIME_DOWNLOAD_STORE, downloadId);
  if (!nanimeCompleteDownload(download)) {
    return nanimeUnavailableMedia(database);
  }
  if (!await nanimeAvailableInventory(database, download, downloadId)) {
    return nanimeUnavailableMedia(database);
  }
  return nanimeOfflineMedia(database, download, downloadId);
}

async function nanimeAvailableInventory(database, download, downloadId) {
  if (!await nanimeDownloadIsActive(database, download)) {
    return false;
  }
  const inventory = await nanimeChunkInventory(database, downloadId);
  return nanimeCompleteInventory(download, inventory);
}

globalThis.NanimeOfflineStorage = Object.freeze({
  DATABASE_NAME: NANIME_OFFLINE_DATABASE,
  DATABASE_VERSION: NANIME_OFFLINE_DATABASE_VERSION,
  DOWNLOAD_STORE: NANIME_DOWNLOAD_STORE,
  MEDIA_CHUNK_SIZE: NANIME_MEDIA_CHUNK_SIZE,
  MEDIA_CHUNK_STORE: NANIME_MEDIA_CHUNK_STORE,
  MEDIA_CHUNK_INVENTORY_STORE: NANIME_MEDIA_CHUNK_INVENTORY_STORE,
  PROFILE_STORE: NANIME_PROFILE_STORE,
  completeInventory: nanimeCompleteInventory,
  loadOfflineMedia: nanimeLoadOfflineMedia,
  storedMediaStream: nanimeStoredMediaStream,
});
