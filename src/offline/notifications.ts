import type { MediaEntry } from "../types.ts";

export interface OfflineDownloadNotice {
  readonly id: string;
  readonly name: string;
}

type NoticeListener = () => void;

const listeners = new Set<NoticeListener>();
let notice: OfflineDownloadNotice | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | undefined = undefined;

function publish(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function offlineDownloadNoticeSnapshot(): OfflineDownloadNotice | null {
  return notice;
}

export function subscribeToOfflineDownloadNotices(listener: NoticeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dismissOfflineDownloadNotice(): void {
  clearTimeout(dismissTimer);
  dismissTimer = undefined;
  notice = null;
  publish();
}

export function announceOfflineDownload(entry: MediaEntry, durationMs = 8000): void {
  clearTimeout(dismissTimer);
  notice = { id: crypto.randomUUID(), name: entry.name };
  publish();
  dismissTimer = setTimeout(dismissOfflineDownloadNotice, durationMs);
}
