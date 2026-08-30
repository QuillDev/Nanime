import type { MediaEntry } from "../types.ts";
import type { OfflineDownload } from "./types.ts";

const activeDownloads = new Map<string, OfflineDownload>();
const activeControllers = new Map<string, AbortController>();

function activityKey(userId: number, rel: string): string {
  return `${String(userId)}:${rel}`;
}

export function preparingOfflineDownload(
  entry: MediaEntry,
  userId: number,
  now = Date.now(),
): OfflineDownload {
  return {
    ...entry,
    id: crypto.randomUUID(),
    userId,
    state: "preparing",
    sourceUrl: "",
    sourceVersion: null,
    contentType: "video/mp4",
    totalBytes: 0,
    downloadedBytes: 0,
    duration: null,
    preparationProgress: 0,
    createdAt: now,
    updatedAt: now,
    error: null,
  };
}

export function trackOfflineDownload(download: OfflineDownload): void {
  activeDownloads.set(activityKey(download.userId, download.rel), download);
}

export function stopTrackingOfflineDownload(download: OfflineDownload): void {
  activeDownloads.delete(activityKey(download.userId, download.rel));
}

export function trackOfflineController(rel: string, controller: AbortController): void {
  activeControllers.set(rel, controller);
}

export function stopTrackingOfflineController(rel: string, controller: AbortController): void {
  if (activeControllers.get(rel) === controller) {
    activeControllers.delete(rel);
  }
}

export function cancelTrackedOfflineDownload(rel: string): void {
  activeControllers.get(rel)?.abort();
}

export function trackedOfflineDownloads(userId: number): readonly OfflineDownload[] {
  return [...activeDownloads.values()].filter((download) => download.userId === userId);
}

export function mergeOfflineDownloads(
  stored: readonly OfflineDownload[],
  tracked: readonly OfflineDownload[],
): readonly OfflineDownload[] {
  const activeRelations = new Set(tracked.map((download) => download.rel));
  return [
    ...tracked,
    ...stored.filter((download) => !activeRelations.has(download.rel)),
  ];
}
