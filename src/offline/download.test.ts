import { describe, expect, test } from "bun:test";
import type { MediaEntry } from "../types.ts";
import { prepareOfflineStorage } from "./capacity.ts";
import { isOfflineDownloadAvailable } from "./database.ts";
import { downloadOfflineMedia, OFFLINE_MEDIA_CHUNK_BYTES } from "./download.ts";
import type {
  OfflineDownload,
} from "./types.ts";
import { MemoryOfflineStore } from "./downloadTestSupport.test.ts";

const ENTRY: MediaEntry = {
  rel: "Example/Season 01/Episode 01.mp4",
  name: "Episode 01.mp4",
  folder: "Example/Season 01",
  size: 10,
  direct: true,
};

function streamResponse(
  parts: readonly Uint8Array[],
  init: ResponseInit = {},
): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  }), init);
}

function source(size: number) {
  return {
    mediaUrl: "/offline-media/prepared/media",
    size,
    version: '"source-v1"',
    contentType: "video/mp4",
    duration: 24 * 60,
  } as const;
}

function savedDownload(overrides: Partial<OfflineDownload> = {}): OfflineDownload {
  return {
    ...ENTRY,
    id: "download-1",
    userId: 7,
    state: "paused",
    sourceUrl: source(6).mediaUrl,
    sourceVersion: source(6).version,
    contentType: "video/mp4",
    totalBytes: 6,
    downloadedBytes: 3,
    duration: 100,
    createdAt: 1,
    updatedAt: 2,
    error: null,
    ...overrides,
  };
}

async function completeChunkedDownload() {
  const store = new MemoryOfflineStore();
  const size = OFFLINE_MEDIA_CHUNK_BYTES * 9 + 3;
  const states: string[] = [];
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  const request = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const header = new Headers(init?.headers).get("range") ?? "";
    const match = /^bytes=(?<start>\d+)-(?<end>\d+)$/u.exec(header);
    const start = Number(match?.groups?.["start"]);
    const end = Number(match?.groups?.["end"]);
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    await Promise.resolve();
    activeRequests -= 1;
    return streamResponse([new Uint8Array(end - start + 1).fill(1)], {
      status: 206,
      headers: { "content-range": `bytes ${String(start)}-${String(end)}/${String(size)}`, etag: '"source-v1"' },
    });
  };
  const result = await downloadOfflineMedia({
    userId: 7,
    entry: ENTRY,
    source: source(size),
    store,
    fetch: request,
    onProgress: (download) => states.push(download.state),
  });
  return { maximumActiveRequests, result, size, states, store };
}

describe("offline media download manager", () => {
  test("fetches bounded ranges concurrently and commits fixed-size chunks in order", async () => {
    const { maximumActiveRequests, result, size, states, store } = await completeChunkedDownload();

    expect(isOfflineDownloadAvailable(result)).toBe(true);
    expect(result.downloadedBytes).toBe(size);
    expect(maximumActiveRequests).toBe(8);
    expect(store.chunks.get(`${result.id}:0`)?.byteLength).toBe(OFFLINE_MEDIA_CHUNK_BYTES);
    expect(store.chunks.get(`${result.id}:9`)?.byteLength).toBe(3);
    expect(states.at(-1)).toBe("complete");
    expect(await store.listDownloads(7, true)).toEqual([result]);
  });

  test("repairs a partial chunk instead of trusting stale progress", async () => {
    const store = new MemoryOfflineStore();
    const paused = savedDownload();
    await store.putDownload(paused);
    store.chunks.set(`${paused.id}:0`, new Uint8Array([1, 2, 3]).buffer);
    const request = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      expect(new Headers(init?.headers).get("range")).toBe("bytes=0-5");
      expect(new Headers(init?.headers).get("if-range")).toBe('"source-v1"');
      return Promise.resolve(streamResponse([new Uint8Array([1, 2, 3, 4, 5, 6])], {
        status: 206,
        headers: {
          "content-range": "bytes 0-5/6",
          etag: '"source-v1"',
        },
      }));
    };

    const result = await downloadOfflineMedia({
      userId: 7,
      entry: ENTRY,
      source: source(6),
      store,
      fetch: request,
    });

    expect(result.state).toBe("complete");
    expect([...new Uint8Array(store.chunks.get(`${paused.id}:0`) as ArrayBuffer)])
      .toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("does not expose a mismatched resume response as complete", async () => {
    const store = new MemoryOfflineStore();
    const paused = savedDownload();
    await store.putDownload(paused);
    store.chunks.set(`${paused.id}:0`, new Uint8Array([1, 2, 3]).buffer);

    await expect(downloadOfflineMedia({
      userId: 7,
      entry: ENTRY,
      source: source(6),
      store,
      fetch: () => Promise.resolve(streamResponse([new Uint8Array([9, 9, 9])], {
        status: 200,
        headers: { etag: '"source-v2"' },
      })),
    })).rejects.toThrow("changed while the download was paused");

    const failed = await store.findDownload(7, ENTRY.rel);
    expect(failed?.state).toBe("failed");
    expect(await store.listDownloads(7, true)).toEqual([]);
  });

  test("publishes streamed progress before a complete chunk is committed", async () => {
    const store = new MemoryOfflineStore();
    const progress: number[] = [];
    const result = await downloadOfflineMedia({
      userId: 7,
      entry: ENTRY,
      source: source(6),
      store,
      fetch: () => Promise.resolve(streamResponse([
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5, 6]),
      ], {
        status: 206,
        headers: { "content-range": "bytes 0-5/6", etag: '"source-v1"' },
      })),
      onProgress: (download) => progress.push(download.downloadedBytes),
    });

    expect(result.state).toBe("complete");
    expect(progress).toContain(3);
    expect(progress.at(-1)).toBe(6);
  });

  test("retries a transient range failure without failing the episode", async () => {
    const store = new MemoryOfflineStore();
    let attempts = 0;
    const request = () => {
      attempts += 1;
      return Promise.resolve(attempts === 1
        ? new Response(null, { status: 503 })
        : streamResponse([new Uint8Array([1, 2, 3, 4, 5, 6])], {
          status: 206,
          headers: { "content-range": "bytes 0-5/6", etag: '"source-v1"' },
        }));
    };

    const result = await downloadOfflineMedia({
      userId: 7, entry: ENTRY, source: source(6), store, fetch: request,
    });
    expect(result.state).toBe("complete");
    expect(attempts).toBe(2);
  });

  test("keeps identically named downloads isolated by user", async () => {
    const store = new MemoryOfflineStore();
    await store.putDownload(savedDownload({ state: "complete", downloadedBytes: 6 }));
    await store.putDownload(savedDownload({
      id: "download-2",
      userId: 8,
      state: "complete",
      downloadedBytes: 6,
    }));

    const userSeven = await store.listDownloads(7, true);
    const userEight = await store.listDownloads(8, true);
    expect(userSeven.map((item) => item.id)).toEqual(["download-1"]);
    expect(userEight.map((item) => item.id)).toEqual(["download-2"]);
  });
});

describe("offline storage capacity", () => {
  test("requests persistence and reports usable capacity", async () => {
    const manager = {
      estimate: () => Promise.resolve({ quota: 1000, usage: 250 }),
      persisted: () => Promise.resolve(false),
      persist: () => Promise.resolve(true),
    } as StorageManager;

    await expect(prepareOfflineStorage(700, manager)).resolves.toEqual({
      availableBytes: 750,
      persisted: true,
      quotaBytes: 1000,
      sufficient: true,
      usageBytes: 250,
    });
  });

  test("degrades safely when storage management is unavailable", async () => {
    await expect(prepareOfflineStorage(1, undefined)).resolves.toEqual({
      availableBytes: null,
      persisted: false,
      quotaBytes: null,
      sufficient: null,
      usageBytes: null,
    });
  });
});
