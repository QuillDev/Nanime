import { describe, expect, test } from "bun:test";
import type { MediaScan, TranscodeJob } from "../types.ts";
import { buildVideoStatuses, needsTranscodeCount } from "./videoStatus.ts";

function scan(sourcePath: string, videoCodec: string | null): MediaScan {
  return {
    sourcePath, status: "complete", fileSize: 1, duration: 1440, formatName: "matroska", videoCodec,
    width: 1920, height: 1080, audioBytes: 0, subtitleBytes: 0, scannedAt: 1, error: null, updatedAt: 1,
  };
}

function job(sourcePath: string, status: TranscodeJob["status"]): TranscodeJob {
  return {
    id: sourcePath, sourcePath, preset: "compatibility", status, inputSize: 1, outputSize: null, progress: 0,
    speed: 0, startedAt: null, error: null, originalDeleted: false, createdAt: 1, updatedAt: 1,
  };
}

describe("buildVideoStatuses", () => {
  test("flags scanned non-H.264 files without a usable stored transcode", () => {
    const statuses = buildVideoStatuses(
      [scan("a.mkv", "hevc"), scan("b.mkv", "h264"), scan("c.mkv", "hevc"), scan("d.mkv", "hevc"), scan("e.mkv", null)],
      [job("c.mkv", "complete"), job("d.mkv", "failed")],
    );
    expect(["a.mkv", "b.mkv", "c.mkv", "d.mkv", "e.mkv"].map((rel) => statuses.get(rel)?.needsTranscode)).toEqual([true, false, false, true, false]);
    expect(statuses.get("a.mkv")).toMatchObject({ codec: "HEVC", resolution: "1080p" });
    expect(needsTranscodeCount(["a.mkv", "b.mkv", "d.mkv", "unscanned.mkv"], statuses)).toBe(2);
  });
});
