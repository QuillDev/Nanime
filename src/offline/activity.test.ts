import { describe, expect, test } from "bun:test";
import {
  cancelTrackedOfflineDownload,
  mergeOfflineDownloads,
  preparingOfflineDownload,
  stopTrackingOfflineController,
  trackOfflineController,
  updateOfflineDownloadList,
} from "./activity.ts";
import type { OfflineDownload } from "./types.ts";

const entry = {
  direct: false,
  folder: "Example Show",
  name: "Example Show S01E01",
  path: "/media/Example Show S01E01.mkv",
  rel: "Example Show S01E01.mkv",
  size: 1024,
};

describe("offline download activity", () => {
  test("creates a visible preparation record before media bytes are available", () => {
    const download = preparingOfflineDownload(entry, 7, 123);
    expect(download).toMatchObject({
      userId: 7,
      state: "preparing",
      totalBytes: 0,
      downloadedBytes: 0,
      preparationProgress: 0,
      createdAt: 123,
    });
  });

  test("tracked progress replaces an older stored record for the same episode", () => {
    const stored = { ...preparingOfflineDownload(entry, 7), id: "stored", state: "paused" } as OfflineDownload;
    const active = { ...stored, id: "active", state: "downloading", downloadedBytes: 512 } as OfflineDownload;
    expect(mergeOfflineDownloads([stored], [active])).toEqual([active]);
  });

  test("allows the downloads page to cancel the request that started elsewhere", () => {
    const controller = new AbortController();
    trackOfflineController(entry.rel, controller);
    cancelTrackedOfflineDownload(entry.rel);
    expect(controller.signal.aborted).toBe(true);
    stopTrackingOfflineController(entry.rel, controller);
  });

  test("does not retain a controller after its own download settles", () => {
    const controller = new AbortController();
    trackOfflineController(entry.rel, controller);
    stopTrackingOfflineController(entry.rel, controller);
    cancelTrackedOfflineDownload(entry.rel);
    expect(controller.signal.aborted).toBe(false);
  });

  test("updates concurrent progress without moving episode rows", () => {
    const first = preparingOfflineDownload({ ...entry, rel: "episode-1" }, 7, 1);
    const second = preparingOfflineDownload({ ...entry, rel: "episode-2" }, 7, 2);
    const third = preparingOfflineDownload({ ...entry, rel: "episode-3" }, 7, 3);
    const initial = [first, second, third];
    const updatedSecond = {
      ...second,
      id: "durable-episode-2",
      state: "downloading" as const,
      downloadedBytes: 512,
    };

    const updated = updateOfflineDownloadList(initial, updatedSecond);
    expect(updated.map((download) => download.rel)).toEqual([
      "episode-1", "episode-2", "episode-3",
    ]);
    expect(updated[1]).toBe(updatedSecond);
  });

  test("appends newly started episodes in their start order", () => {
    const first = preparingOfflineDownload({ ...entry, rel: "episode-1" }, 7, 1);
    const second = preparingOfflineDownload({ ...entry, rel: "episode-2" }, 7, 2);
    const downloads = updateOfflineDownloadList(
      updateOfflineDownloadList([], first), second);

    expect(downloads.map((download) => download.rel)).toEqual(["episode-1", "episode-2"]);
  });
});
