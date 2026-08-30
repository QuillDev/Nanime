import { describe, expect, test } from "bun:test";
import {
  announceOfflineDownload,
  dismissOfflineDownloadNotice,
  offlineDownloadNoticeSnapshot,
  subscribeToOfflineDownloadNotices,
} from "./notifications.ts";

const entry = {
  direct: false,
  folder: "Example Show",
  name: "Example Show - 01.mkv",
  rel: "Example Show/Example Show - 01.mkv",
  size: 1024,
};

describe("offline download notifications", () => {
  test("publishes and dismisses a download-started notice", () => {
    let updates = 0;
    const unsubscribe = subscribeToOfflineDownloadNotices(() => {
      updates += 1;
    });
    announceOfflineDownload(entry);
    expect(offlineDownloadNoticeSnapshot()?.name).toBe(entry.name);
    dismissOfflineDownloadNotice();
    expect(offlineDownloadNoticeSnapshot()).toBeNull();
    expect(updates).toBe(2);
    unsubscribe();
  });
});
