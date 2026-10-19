import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  offlineTranscodeArgs,
} from "./offlineMedia.ts";
import { parseByteRange, rangedFileResponse, responseByteRange } from "./httpRange.ts";
import { makeClip, probeStreams, run, withTemporaryDirectory } from "./testMedia.ts";

async function moovPrecedesMdat(path: string): Promise<boolean> {
  const bytes = Buffer.from(await Bun.file(path).bytes());
  return bytes.indexOf("moov") < bytes.indexOf("mdat");
}

describe("offline media packaging", () => {
  test("creates a faststart H.264/AAC MP4 carrying only the selected audio track", async () => {
    await withTemporaryDirectory("nanime-offline-package-", async (directory) => {
      const source = await makeClip(join(directory, "Episode 01.mkv"), { seconds: 3, audio: ["eng", "jpn"] });
      const output = join(directory, "artifact.mp4");
      await run(["ffmpeg", ...offlineTranscodeArgs(source, 2, output)]);

      const streams = await probeStreams(output);
      expect(streams.map((stream) => [stream.codec_type, stream.codec_name])).toEqual([["video", "h264"], ["audio", "aac"]]);
      expect(streams[1]?.tags?.language).toBe("jpn");
      expect(streams[1]?.channels).toBe(2);
      expect(await moovPrecedesMdat(output)).toBe(true);
    });
  }, 30_000);

  test("does not invent an audio stream for silent media", async () => {
    await withTemporaryDirectory("nanime-offline-silent-", async (directory) => {
      const source = await makeClip(join(directory, "silent.mkv"), { seconds: 2 });
      const output = join(directory, "silent.mp4");
      await run(["ffmpeg", ...offlineTranscodeArgs(source, null, output)]);

      const streams = await probeStreams(output);
      expect(streams.map((stream) => stream.codec_type)).toEqual(["video"]);
    });
  }, 30_000);
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

  test("allows direct streams to require revalidation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nanime-direct-range-"));
    const path = join(directory, "fixture.mp4");
    try {
      await Bun.write(path, Uint8Array.from({ length: 32 }, (_, index) => index));
      const response = rangedFileResponse({
        path,
        mimeType: "video/mp4",
        etag: '"direct-fixture"',
        req: new Request("http://nanime.test/stream", { headers: { range: "bytes=8-15" } }),
        cacheControl: "private, no-cache",
      });
      expect(response.status).toBe(206);
      expect(response.headers.get("cache-control")).toBe("private, no-cache");
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
