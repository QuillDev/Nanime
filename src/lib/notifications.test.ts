import { expect, test } from "bun:test";
import type { TorrentStatus, TranscodeJob } from "../types.ts";
import type { ShowGroup } from "./library.ts";
import { collectNotifications } from "./notifications.ts";

function torrent(hash: string, progress: number, state: string): TorrentStatus {
  return { hash, name: hash, showFolder: null, progress, downloadSpeed: 0, eta: 0, completed: 0, size: 1, state, addedOn: 0 };
}

function job(id: string, status: TranscodeJob["status"], createdAt = 0): TranscodeJob {
  return {
    id, sourcePath: `Show/${id}.mkv`, preset: "space-saver", status, inputSize: 1, outputSize: null, progress: 0,
    speed: 0, startedAt: null, error: null, originalDeleted: false, createdAt, updatedAt: createdAt,
  };
}

const show: ShowGroup = { name: "Unmatched", sourceNames: ["Unmatched"], seasons: [], entries: [] };

test("is idle when nothing is unmatched, downloading or transcoding", () => {
  const notifications = collectNotifications({
    unmapped: [],
    torrents: [torrent("seeding", 1, "uploading")],
    jobs: [job("done", "complete"), job("failed", "failed")],
  });
  expect(notifications.tone).toBe("idle");
  expect(notifications.downloads).toEqual([]);
  expect(notifications.transcodes).toEqual([]);
});

test("is busy while downloads or transcodes run", () => {
  const notifications = collectNotifications({
    unmapped: [],
    torrents: [torrent("a", 0.4, "downloading")],
    jobs: [job("queued", "queued", 1), job("running", "processing", 2)],
  });
  expect(notifications.tone).toBe("busy");
  expect(notifications.transcodes.map((item) => item.id)).toEqual(["running", "queued"]);
});

test("needs attention for unmatched shows or stuck downloads, stuck ones listed first", () => {
  expect(collectNotifications({ unmapped: [show], torrents: [], jobs: [] }).tone).toBe("attention");
  const stuck = collectNotifications({
    unmapped: [],
    torrents: [{ ...torrent("newer", 0.5, "downloading"), addedOn: 2 }, { ...torrent("stalled", 0.1, "stalledDL"), addedOn: 1 }],
    jobs: [],
  });
  expect(stuck.tone).toBe("attention");
  expect(stuck.downloads.map((item) => item.hash)).toEqual(["stalled", "newer"]);
});
