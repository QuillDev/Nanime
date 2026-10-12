import { afterEach, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MediaEntry, PlaybackProgress } from "../shared/types.ts";
import { getJson, operationStatus, reference, startLibraryTestServer, type LibraryTestServer } from "./libraryFilesTestServer.ts";

let server: LibraryTestServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

// Separate process: browser globals, IndexedDB, and the runtime singleton never
// contaminate other tests. Requests go only to the isolated loopback fixture.
const replayScript = String.raw`
  import assert from "node:assert/strict";
  import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
  const [origin, cookie, a, b] = process.argv.slice(1);
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
    key: (index) => [...storage.keys()][index] ?? null,
    get length() { return storage.size; },
  };
  const runtime = await import("./src/offline/runtime.ts");
  await runtime.rememberOfflineUser({ id: 1, username: "admin", isAdmin: true, preferredAudioLanguage: null });
  const base = { rel: "old.mkv", name: "old.mkv", folder: "", size: 1, direct: true };
  const download = {
    ...base, mediaIdentity: a, id: "download-a", userId: 1, state: "complete",
    sourceUrl: "/stream?path=old.mkv", sourceVersion: null, contentType: "video/mp4",
    totalBytes: 1, downloadedBytes: 1, duration: 100, createdAt: 1, updatedAt: 1, error: null,
  };
  await runtime.offlineStore().putDownload(download);
  await runtime.rememberOfflineLibrary([{ ...base, mediaIdentity: b }]);
  const [offline] = await runtime.offlineLibraryFallback();
  assert.equal(offline.mediaIdentity, a, "offline A must not inherit replacement B's identity");
  const update = { rel: offline.rel, mediaIdentity: offline.mediaIdentity, position: 42, duration: 100, completed: false, event: "heartbeat" };
  await runtime.saveOfflinePlayback(update);
  await runtime.saveOfflinePlayback({ ...update, mediaIdentity: b, position: 74 });
  const queued = JSON.parse(storage.get("nanime.offline.playback-outbox.1"));
  assert.deepEqual(queued.map((item) => item.update.mediaIdentity), [a, b]);
  await runtime.flushOfflinePlayback(async (body) => {
    const response = await fetch(origin + "/api/progress", {
      method: "PUT", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    return response.json();
  });
  assert.deepEqual(JSON.parse(storage.get("nanime.offline.playback-outbox.1")), []);
  // Old downloads without an identity must remain legacy, not inherit B's token.
  const { mediaIdentity, ...legacy } = download;
  await runtime.offlineStore().putDownload(legacy);
  const [oldDownload] = await runtime.offlineLibraryFallback();
  assert.equal(oldDownload.mediaIdentity, undefined);
  console.log("offline replay verified");
`;

test("offline downloads retain occupant identity and queued heartbeats for reused paths replay to separate media", async () => {
  server = await startLibraryTestServer(async (media) => {
    await writeFile(join(media, "old.mkv"), "A");
    await writeFile(join(media, "replacement.mkv"), "B");
  });
  const target = server;
  const entries = await getJson<readonly MediaEntry[]>(target, "/api/list");
  const a = entries.find((entry) => entry.rel === "old.mkv")?.mediaIdentity;
  const b = entries.find((entry) => entry.rel === "replacement.mkv")?.mediaIdentity;
  if (a === undefined || b === undefined) {
    throw new Error("Missing occupant identity");
  }
  expect(await operationStatus(target, "rename", { item: await reference(target, "old.mkv"), name: "new.mkv" })).toBe(200);
  expect(await operationStatus(target, "rename", { item: await reference(target, "replacement.mkv"), name: "old.mkv" })).toBe(200);
  const child = Bun.spawn([process.execPath, "-e", replayScript, target.origin, target.adminCookie, a, b], {
    cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe",
  });
  const [output, error, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ status, error }).toEqual({ status: 0, error: "" });
  expect(output.trim()).toBe("offline replay verified");
  const progress = await getJson<readonly PlaybackProgress[]>(target, "/api/progress");
  expect(progress.map((entry) => ({ rel: entry.rel, position: entry.position })).toSorted((left, right) => left.rel.localeCompare(right.rel)))
    .toEqual([{ rel: "new.mkv", position: 42 }, { rel: "old.mkv", position: 74 }]);
});
