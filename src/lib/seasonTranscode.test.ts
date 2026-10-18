import { expect, test } from "bun:test";
import type { PlaybackReadiness } from "../libraryApi.ts";
import { formatRemaining, summarizeSeasonTranscode } from "./seasonTranscode.ts";

function item(path: string, ready: boolean, transcode: PlaybackReadiness["transcode"] = null): PlaybackReadiness {
  return { path, ready, transcode };
}

const paths = ["s/01.mkv", "s/02.mkv", "s/03.mkv", "s/04.mkv"];

test("a season with no stored transcodes needs one and has nothing playable", () => {
  const summary = summarizeSeasonTranscode(paths, 4, { workers: 2, items: paths.map((path) => item(path, false)) });
  expect(summary.kind).toBe("needs-transcode");
  expect(summary.ready).toBe(0);
  expect(summary.remainingSeconds).toBeNull();
  expect(summary.episodes.get("s/01.mkv")).toEqual({ kind: "needs-transcode" });
});

test("a transcoding season counts ready episodes, marks the next queued one and projects the finish", () => {
  const summary = summarizeSeasonTranscode(paths, 5, {
    workers: 2,
    items: [
      item("s/01.mkv", true, { status: "complete", progress: 1, remainingSeconds: null }),
      item("s/02.mkv", false, { status: "processing", progress: 0.5, remainingSeconds: 600 }),
      item("s/03.mkv", false, { status: "queued", progress: 0, remainingSeconds: null }),
      item("s/04.mkv", false, { status: "queued", progress: 0, remainingSeconds: null }),
    ],
  });
  expect(summary.kind).toBe("transcoding");
  // One directly playable episode outside the batch plus one finished transcode.
  expect(summary.ready).toBe(2);
  expect(summary.episodes.get("s/03.mkv")).toEqual({ kind: "queued", next: true });
  expect(summary.episodes.get("s/04.mkv")).toEqual({ kind: "queued", next: false });
  // 600 s left on the running one, two queued at its 1200 s pace, shared by two workers.
  expect(summary.remainingSeconds).toBe(1500);
});

test("the season finish is unknown until every running episode has an estimate", () => {
  const summary = summarizeSeasonTranscode(paths.slice(0, 2), 2, {
    workers: 2,
    items: [
      item("s/01.mkv", false, { status: "processing", progress: 0.4, remainingSeconds: 300 }),
      item("s/02.mkv", false, { status: "processing", progress: 0, remainingSeconds: null }),
    ],
  });
  expect(summary.remainingSeconds).toBeNull();
});

test("a failed transcode leaves the season needing action", () => {
  const summary = summarizeSeasonTranscode(paths.slice(0, 1), 1, {
    workers: 1,
    items: [item("s/01.mkv", false, { status: "failed", progress: 0.2, remainingSeconds: null })],
  });
  expect(summary.kind).toBe("needs-transcode");
  expect(summary.episodes.get("s/01.mkv")).toEqual({ kind: "failed" });
});

test("formats remaining time for people", () => {
  expect(formatRemaining(20)).toBe("1 min");
  expect(formatRemaining(31 * 60)).toBe("31 min");
  expect(formatRemaining(95 * 60)).toBe("1 h 35 min");
  expect(formatRemaining(120 * 60)).toBe("2 h");
});
