import { describe, expect, test } from "bun:test";
import type { MediaEntry } from "../types.ts";
import {
  downloadOfflineMedia,
  OFFLINE_MEDIA_CHUNK_BYTES,
  OFFLINE_MEDIA_PARALLEL_REQUESTS,
} from "./download.ts";
import { ControlledRangeServer } from "./controlledRangeServer.test.ts";
import { MemoryOfflineStore } from "./downloadTestSupport.test.ts";
import type { OfflineDownload } from "./types.ts";

class DeleteAtCompletionStore extends MemoryOfflineStore {
  override async completeDownload(
    transition: Parameters<MemoryOfflineStore["completeDownload"]>[0],
  ): Promise<OfflineDownload> {
    await this.removeDownload(transition.downloadId);
    return super.completeDownload(transition);
  }
}

const ENTRY: MediaEntry = {
  rel: "Pool/Season 01/Episode 01.mp4",
  name: "Episode 01.mp4",
  folder: "Pool/Season 01",
  size: 10,
  direct: true,
};

function source(size: number) {
  return {
    mediaUrl: "/offline-media/prepared/media",
    size,
    version: '"source-v1"',
    contentType: "video/mp4",
  } as const;
}

function savedComplete(totalBytes: number): OfflineDownload {
  return {
    ...ENTRY,
    id: "download-pool",
    userId: 7,
    state: "complete",
    sourceUrl: source(totalBytes).mediaUrl,
    sourceVersion: source(totalBytes).version,
    contentType: "video/mp4",
    totalBytes,
    downloadedBytes: totalBytes,
    duration: 100,
    createdAt: 1,
    updatedAt: 2,
    error: null,
  };
}

interface DownloadScenario {
  readonly downloading: Promise<OfflineDownload>;
  readonly progress: number[];
  readonly server: ControlledRangeServer;
  readonly store: MemoryOfflineStore;
  readonly totalBytes: number;
}

function startScenario(
  chunkCount: number,
  store: MemoryOfflineStore = new MemoryOfflineStore(),
  signal?: AbortSignal,
): DownloadScenario {
  const totalBytes = OFFLINE_MEDIA_CHUNK_BYTES * chunkCount;
  const server = new ControlledRangeServer();
  const progress: number[] = [];
  const downloading = downloadOfflineMedia({
    userId: 7, entry: ENTRY, source: source(totalBytes), store, fetch: server.fetch, signal,
    onProgress: (download) => progress.push(download.downloadedBytes),
  });
  return { downloading, progress, server, store, totalBytes };
}

async function refillStragglingScenario(scenario: DownloadScenario): Promise<void> {
  await scenario.server.waitForStarts(8);
  expect(OFFLINE_MEDIA_PARALLEL_REQUESTS).toBe(8);
  expect(scenario.server.started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  scenario.server.resolve(1, scenario.totalBytes);
  await scenario.server.waitForStarts(9);
  expect(scenario.server.started[8]).toBe(8);
  scenario.server.resolve(2, scenario.totalBytes);
  await scenario.server.waitForStarts(10);
  expect(scenario.server.started.slice(8)).toEqual([8, 9]);
}

async function finishStragglingScenario(
  scenario: DownloadScenario,
): Promise<OfflineDownload> {
  expect(scenario.server.active).toBe(8);
  for (const index of [7, 3, 5, 9, 6, 4, 8, 0]) {
    scenario.server.resolve(index, scenario.totalBytes);
  }
  return await scenario.downloading;
}

function expectIndexedChunks(scenario: DownloadScenario, result: OfflineDownload): void {
  expect(scenario.server.maxActive).toBe(8);
  expect(new Set(scenario.server.started).size).toBe(10);
  expect(result.state).toBe("complete");
  expect(scenario.progress.toSorted((left, right) => left - right)).toEqual(scenario.progress);
  for (let index = 0; index < 10; index += 1) {
    const bytes = scenario.store.chunks.get(`${result.id}:${String(index)}`);
    expect(new Uint8Array(bytes as ArrayBuffer)[0]).toBe(index + 1);
  }
}

async function repairStore(totalBytes: number): Promise<MemoryOfflineStore> {
  const store = new MemoryOfflineStore();
  const saved = savedComplete(totalBytes);
  await store.putDownload(saved);
  store.chunks.set(`${saved.id}:0`, new Uint8Array(OFFLINE_MEDIA_CHUNK_BYTES).fill(11).buffer);
  store.chunks.set(`${saved.id}:2`, new Uint8Array(OFFLINE_MEDIA_CHUNK_BYTES).fill(33).buffer);
  return store;
}

function expectRepairedChunks(store: MemoryOfflineStore, result: OfflineDownload): void {
  expect(result.id).toBe("download-pool");
  expect(result.state).toBe("complete");
  expect(new Uint8Array(store.chunks.get(`${result.id}:0`) as ArrayBuffer)[0]).toBe(11);
  expect(new Uint8Array(store.chunks.get(`${result.id}:1`) as ArrayBuffer)[0]).toBe(22);
  expect(new Uint8Array(store.chunks.get(`${result.id}:2`) as ArrayBuffer)[0]).toBe(33);
}

function duplicateOptions(
  scenario: DownloadScenario,
  signal?: AbortSignal,
  onProgress?: (download: OfflineDownload) => void,
) {
  return {
    userId: 7,
    entry: ENTRY,
    source: source(scenario.totalBytes),
    store: scenario.store,
    fetch: scenario.server.fetch,
    signal,
    onProgress,
  };
}

describe("offline download worker pool", () => {
  test("keeps eight requests busy without waiting for a straggler", async () => {
    const scenario = startScenario(10);
    await refillStragglingScenario(scenario);
    const result = await finishStragglingScenario(scenario);
    expectIndexedChunks(scenario, result);
  });

  test("repairs only a missing chunk even when the record claims completion", async () => {
    const totalBytes = OFFLINE_MEDIA_CHUNK_BYTES * 3;
    const scenario = startScenario(3, await repairStore(totalBytes));
    await scenario.server.waitForStarts(1);
    expect(scenario.server.started).toEqual([1]);
    scenario.server.resolve(1, totalBytes, 22);
    expectRepairedChunks(scenario.store, await scenario.downloading);
  });

  test("cancels active workers and leaves the download paused for repair", async () => {
    const controller = new AbortController();
    const scenario = startScenario(12, undefined, controller.signal);
    await scenario.server.waitForStarts(8);
    controller.abort();
    await expect(scenario.downloading).rejects.toMatchObject({ name: "AbortError" });
    expect(scenario.server.started).toHaveLength(8);
    const paused = await scenario.store.findDownload(7, ENTRY.rel);
    expect(paused?.state).toBe("paused");
  });

  test("deduplicates concurrent requests for the same episode", async () => {
    const scenario = startScenario(1);
    const duplicateProgress: number[] = [];
    const first = scenario.downloading;
    const second = downloadOfflineMedia(duplicateOptions(
      scenario, undefined, (download) => duplicateProgress.push(download.downloadedBytes)));
    await scenario.server.waitForStarts(1);
    scenario.server.resolve(0, scenario.totalBytes);
    const results = await Promise.all([first, second]);
    expect(scenario.server.started).toEqual([0]);
    expect(results[0]?.id).toBe(results[1]?.id);
    expect(duplicateProgress.at(-1)).toBe(scenario.totalBytes);
  });

  test("a duplicate caller can cancel the shared episode download", async () => {
    const scenario = startScenario(1);
    const duplicateController = new AbortController();
    const duplicate = downloadOfflineMedia(
      duplicateOptions(scenario, duplicateController.signal));
    await scenario.server.waitForStarts(1);
    duplicateController.abort();
    const results = await Promise.allSettled([scenario.downloading, duplicate]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    const paused = await scenario.store.findDownload(7, ENTRY.rel);
    expect(paused?.state).toBe("paused");
  });

  test("a canceled replacement does not wait for the active generation", async () => {
    const primaryController = new AbortController();
    const scenario = startScenario(1, undefined, primaryController.signal);
    const replacementController = new AbortController();
    const options = duplicateOptions(scenario, replacementController.signal);
    const replacement = downloadOfflineMedia({
      ...options, source: { ...options.source, version: '"source-v2"' },
    });
    await scenario.server.waitForStarts(1);
    replacementController.abort();
    await expect(replacement).rejects.toMatchObject({ name: "AbortError" });
    primaryController.abort();
    await expect(scenario.downloading).rejects.toMatchObject({ name: "AbortError" });
  });

  test("does not resurrect a download removed during finalization", async () => {
    const totalBytes = OFFLINE_MEDIA_CHUNK_BYTES;
    const server = new ControlledRangeServer();
    const store = new DeleteAtCompletionStore();
    const downloading = downloadOfflineMedia({
      userId: 7, entry: ENTRY, source: source(totalBytes), store, fetch: server.fetch,
    });
    await server.waitForStarts(1);
    server.resolve(0, totalBytes);
    await expect(downloading).rejects.toThrow("removed or replaced");
    const removed = await store.findDownload(7, ENTRY.rel);
    expect(removed).toBeNull();
  });
});
