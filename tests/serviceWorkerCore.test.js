import { describe, expect, mock, test } from "bun:test";

const coreModule = await import("../public/swCore.js");
const storageModule = await import("../public/swStorage.js");
void coreModule;
void storageModule;

const worker = globalThis.NanimeOfflineWorker;
const storage = globalThis.NanimeOfflineStorage;

describe("offline chunk inventory", () => {
  test("requires every exact chunk before exposing a completed download", () => {
    const chunkSize = storage.MEDIA_CHUNK_SIZE;
    const download = { totalBytes: chunkSize * 2 + 3 };
    const complete = [
      { index: 0, byteLength: chunkSize },
      { index: 1, byteLength: chunkSize },
      { index: 2, byteLength: 3 },
    ];

    expect(storage.DATABASE_VERSION).toBe(3);
    expect(storage.completeInventory(download, complete)).toBe(true);
    expect(storage.completeInventory(download, complete.filter((chunk) => chunk.index !== 1)))
      .toBe(false);
    expect(storage.completeInventory(download, [
      complete[0],
      { index: 1, byteLength: 2 },
      complete[2],
    ])).toBe(false);
  });
});
const ORIGIN = "https://nanime.example";

function mediaSource(bytes, contentType = "video/mp4") {
  return {
    contentType,
    size: bytes.byteLength,
    read: mock((start, end) => bytes.slice(start, end)),
  };
}

function expectPartialVideoResponse(response) {
  expect(response.status).toBe(206);
  expect(response.headers.get("accept-ranges")).toBe("bytes");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-length")).toBe("5");
  expect(response.headers.get("content-range")).toBe("bytes 3-7/10");
  expect(response.headers.get("content-type")).toBe("video/mp4");
}

function memoryCaches(shell = null) {
  const values = new Map(shell === null ? [] : [["/", shell]]);
  const put = (key, response) => {
    values.set(typeof key === "string" ? key : key.url, response);
    return Promise.resolve();
  };
  return {
    values,
    storage: {
      match: (key) => Promise.resolve(
        values.get(typeof key === "string" ? key : key.url)?.clone(),
      ),
      open: () => Promise.resolve({ put }),
    },
  };
}

describe("offline byte ranges", () => {
  test("resolves complete, bounded, open-ended, and suffix ranges", () => {
    expect(worker.byteRange(null, 10)).toEqual({ kind: "full", start: 0, end: 9 });
    expect(worker.byteRange("bytes=2-5", 10)).toEqual({ kind: "partial", start: 2, end: 5 });
    expect(worker.byteRange("bytes=7-", 10)).toEqual({ kind: "partial", start: 7, end: 9 });
    expect(worker.byteRange("bytes=-4", 10)).toEqual({ kind: "partial", start: 6, end: 9 });
    expect(worker.byteRange("bytes=-40", 10)).toEqual({ kind: "partial", start: 0, end: 9 });
    expect(worker.byteRange("bytes=7-40", 10)).toEqual({ kind: "partial", start: 7, end: 9 });
  });

  test("rejects malformed, multiple, empty, reversed, and out-of-bounds ranges", () => {
    for (const header of [
      "items=0-1",
      "bytes=",
      "bytes=-0",
      "bytes=5-4",
      "bytes=10-",
      "bytes=0-1,4-5",
      "bytes=1-2 trailing",
    ]) {
      expect(worker.byteRange(header, 10)).toEqual({ kind: "unsatisfiable" });
    }
    expect(worker.byteRange("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
  });
});

describe("offline media responses", () => {
  test("streams a byte interval across independently stored chunks", async () => {
    const chunks = ["abc", "def", "ghi"].map((value) => ({
      bytes: new TextEncoder().encode(value).buffer,
    }));
    const close = mock(() => undefined);
    const stream = storage.storedMediaStream({
      downloadId: "download-id",
      start: 2,
      end: 8,
      chunkSize: 3,
      getChunk: (_downloadId, index) => chunks[index],
      onClose: close,
    });

    expect(await new Response(stream).text()).toBe("cdefgh");
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("fails a stream instead of returning corrupted media when a chunk is absent", async () => {
    const stream = storage.storedMediaStream({
      downloadId: "download-id",
      start: 0,
      end: 4,
      chunkSize: 4,
      getChunk: () => undefined,
      onClose: () => undefined,
    });

    await expect(new Response(stream).arrayBuffer()).rejects.toThrow("chunk 0 is missing");
  });

  test("serves an exact seek response with video range headers", async () => {
    const media = mediaSource(new TextEncoder().encode("0123456789"));
    const request = new Request(`${ORIGIN}/offline-download/episode-1/media`, {
      headers: { range: "bytes=3-7" },
    });
    const response = await worker.offlineMediaResponse(request, "episode-1", () => media);

    expectPartialVideoResponse(response);
    expect(await response.text()).toBe("34567");
  });

  test("streams a complete response when the browser does not send Range", async () => {
    const media = mediaSource(new TextEncoder().encode("episode"));
    const request = new Request(`${ORIGIN}/offline-download/episode-2/media`);
    const response = await worker.offlineMediaResponse(request, "episode-2", () => media);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("7");
    expect(response.headers.get("content-range")).toBeNull();
    expect(await response.text()).toBe("episode");
  });

  test("supports HEAD without reading media bytes", async () => {
    const media = mediaSource(new Uint8Array(12));
    const request = new Request(`${ORIGIN}/offline-download/episode-3/media`, {
      method: "HEAD",
      headers: { range: "bytes=2-5" },
    });
    const response = await worker.offlineMediaResponse(request, "episode-3", () => media);

    expect(response.status).toBe(206);
    expect(response.headers.get("content-length")).toBe("4");
    expect(await response.arrayBuffer()).toHaveLength(0);
    expect(media.read).not.toHaveBeenCalled();
  });

  test("returns standards-compliant errors for missing media and invalid ranges", async () => {
    const missingRequest = new Request(`${ORIGIN}/offline-download/missing/media`);
    const missing = await worker.offlineMediaResponse(missingRequest, "missing", () => null);
    expect(missing.status).toBe(404);

    const media = mediaSource(new Uint8Array(8));
    const rangeRequest = new Request(`${ORIGIN}/offline-download/episode-4/media`, {
      headers: { range: "bytes=20-" },
    });
    const invalid = await worker.offlineMediaResponse(rangeRequest, "episode-4", () => media);
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe("bytes */8");
    expect(media.read).not.toHaveBeenCalled();
  });
});

describe("service worker routing", () => {
  test("routes same-origin offline media, downloaded assets, navigations, and shell assets", () => {
    const media = new Request(`${ORIGIN}/offline-download/id%20with%20spaces/media`);
    expect(worker.requestRoute(media, ORIGIN)).toEqual({
      kind: "offline-media",
      downloadId: "id with spaces",
    });
    expect(worker.requestRoute(
      { method: "GET", mode: "navigate", url: `${ORIGIN}/shows/example` },
      ORIGIN,
    )).toEqual({ kind: "navigation" });
    expect(worker.requestRoute(new Request(`${ORIGIN}/assets/app.js`), ORIGIN))
      .toEqual({ kind: "asset" });
    expect(worker.requestRoute(new Request(`${ORIGIN}/api/subtitles?path=show`), ORIGIN))
      .toEqual({ kind: "offline-asset" });
    expect(worker.requestRoute(new Request(`${ORIGIN}/api/list`), ORIGIN))
      .toEqual({ kind: "none" });
    expect(worker.requestRoute(new Request("https://other.example/assets/app.js"), ORIGIN))
      .toEqual({ kind: "none" });
  });

  test("serves a cached downloaded subtitle without touching the network", async () => {
    const request = new Request(`${ORIGIN}/subtitle?path=show&index=1&offset=0`);
    const caches = memoryCaches();
    caches.values.set(request.url, new Response("WEBVTT\n"));
    const fetcher = mock(() => new Response("network"));
    const response = await worker.routeResponse(
      { kind: "offline-asset" },
      request,
      { caches: caches.storage, fetch: fetcher, loadOfflineMedia: () => null },
    );

    expect(await response.text()).toBe("WEBVTT\n");
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("falls back to the cached shell on network and gateway failures", async () => {
    const shell = new Response("offline shell", { headers: { "content-type": "text/html" } });
    const responses = await Promise.all([
      new Error("offline"),
      new Response("gateway", { status: 502 }),
    ].map(async (networkResult) => {
      const caches = memoryCaches(shell);
      const fetcher = networkResult instanceof Error
        ? mock(() => { throw networkResult; })
        : mock(() => networkResult);
      const response = await worker.routeResponse(
        { kind: "navigation" },
        { method: "GET", mode: "navigate", url: `${ORIGIN}/shows/example` },
        { caches: caches.storage, fetch: fetcher, loadOfflineMedia: () => null },
      );
      return await response.text();
    }));
    expect(responses).toEqual(["offline shell", "offline shell"]);
  });

  test("refreshes the cached shell after a successful navigation", async () => {
    const caches = memoryCaches();
    const response = await worker.routeResponse(
      { kind: "navigation" },
      { method: "GET", mode: "navigate", url: `${ORIGIN}/shows/example` },
      {
        caches: caches.storage,
        fetch: () => new Response("fresh shell", { headers: { "content-type": "text/html" } }),
        loadOfflineMedia: () => null,
      },
    );

    expect(await response.text()).toBe("fresh shell");
    expect(await caches.values.get("/")?.text()).toBe("fresh shell");
  });
});
