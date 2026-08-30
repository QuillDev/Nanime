import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  offlineTranscodeArgs,
} from "./offlineMedia.ts";
import { parseByteRange, rangedFileResponse, responseByteRange } from "./httpRange.ts";

describe("offline media packaging", () => {
  test("creates a seekable broadly compatible MP4 with a selected audio track", () => {
    const args = offlineTranscodeArgs(
      "/library/Show/Episode 01.mkv",
      3,
      "/cache/artifact.mp4",
    );

    expect(args).toContain("libx264");
    expect(args).toContain("aac");
    expect(args).toContain("+faststart");
    expect(args).toContain("0:3");
    expect(args.at(-1)).toBe("/cache/artifact.mp4");
    expect(args.slice(-2)).toEqual(["+faststart", "/cache/artifact.mp4"]);
  });

  test("does not invent an audio stream for silent media", () => {
    const args = offlineTranscodeArgs("/library/silent.mkv", null, "/cache/silent.mp4");

    expect(args).not.toContain("-c:a");
    expect(args).not.toContain("0:a:0?");
  });
});

describe("offline media byte ranges", () => {
  test("accepts full, bounded, open, and suffix requests", () => {
    expect(parseByteRange(null, 100)).toBeNull();
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-200", 100)).toEqual({ start: 0, end: 99 });
  });

  test("rejects malformed, multiple, empty, and unsatisfiable ranges", () => {
    expect(parseByteRange("bytes=-", 100)).toBe("invalid");
    expect(parseByteRange("bytes=100-", 100)).toBe("invalid");
    expect(parseByteRange("bytes=20-10", 100)).toBe("invalid");
    expect(parseByteRange("bytes=0-1,5-6", 100)).toBe("invalid");
    expect(parseByteRange("items=0-1", 100)).toBe("invalid");
  });

  test("only resumes a range when If-Range matches the stable artifact ETag", () => {
    const etag = '"offline-artifact-id"';

    expect(responseByteRange({ rangeHeader: "bytes=50-", ifRange: etag, etag, size: 100 }))
      .toEqual({ start: 50, end: 99 });
    expect(responseByteRange({ rangeHeader: "bytes=50-", ifRange: '"stale"', etag, size: 100 }))
      .toBeNull();
    expect(responseByteRange({ rangeHeader: "bytes=50-", ifRange: null, etag, size: 100 }))
      .toEqual({ start: 50, end: 99 });
  });

  test("streams exactly the declared byte interval", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nanime-offline-range-"));
    const path = join(directory, "episode.mp4");
    try {
      await writeFile(path, Uint8Array.from({ length: 256 }, (_value, index) => index));
      const response = rangedFileResponse({
        path,
        mimeType: "video/mp4",
        etag: '"episode"',
        req: new Request("http://nanime.test/media", { headers: { range: "bytes=100-149" } }),
      });
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe("bytes 100-149/256");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(
        Uint8Array.from({ length: 50 }, (_value, index) => index + 100),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
