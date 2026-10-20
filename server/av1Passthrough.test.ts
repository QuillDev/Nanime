import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { audioTracks } from "./audioTracks.ts";
import { sourceKeyframes, startPassthrough } from "./hlsPassthrough.ts";
import { PASSTHROUGH_TIMESTAMP_OFFSET } from "./hlsTranscode.ts";
import { playbackPlan } from "./playbackReadiness.ts";
import { firstVideoPacket, makeClip, probeStreams } from "./testMedia.ts";
import { temporaryDirectory, withTemporaryDirectory } from "./testProcess.ts";

let root = "";
let options = { mediaDir: "", mediaRoot: "", videoExtensions: new Set([".mkv"]), hardwareAcceleration: "" };
const rel = "AV1 show/av1-10bit.mkv";
const DURATION = 12;

beforeAll(async () => {
  root = await temporaryDirectory("nanime-av1-passthrough-");
  options = { ...options, mediaDir: root, mediaRoot: root };
  await mkdir(join(root, "AV1 show"));
  // Like real AV1 releases: 10-bit video with Opus audio in Matroska.
  await makeClip(join(root, rel), {
    seconds: DURATION, rate: "24000/1001", audio: ["jpn"], audioCodec: "libopus", channels: 2,
    video: ["-c:v", "libsvtav1", "-preset", "12", "-pix_fmt", "yuv420p10le", "-g", "72"],
  });
}, 60_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("10-bit AV1 streams untouched only for clients that decode AV1", async () => {
  const abs = join(root, rel);

  expect(await playbackPlan(abs, rel, { ...options, av1Client: true }))
    .toEqual({ kind: "stream", source: { input: abs, videoMode: "passthrough" } });
  expect(await playbackPlan(abs, rel, { ...options, hevcClient: true }))
    .toEqual({ kind: "transcode-required", transcode: null });
  expect(await playbackPlan(abs, rel, options))
    .toEqual({ kind: "transcode-required", transcode: null });
});

test("AV1 passthrough segments carry av01 video and browser-safe audio from a keyframe", async () => {
  const abs = join(root, rel);
  await withTemporaryDirectory("nanime-av1-session-", async (directory) => {
    const [audioTrack] = await audioTracks(abs);
    const keyframes = await sourceKeyframes(abs);
    const producer = await startPassthrough({ input: abs, audioTrack, directory, duration: DURATION });
    try {
      const segment = await producer.segmentPath("segment-000001.m4s");
      const init = await producer.segmentPath("init.mp4");
      if (segment === null || init === null) {
        throw new Error("passthrough segments were not produced");
      }
      const joined = `concat:${init}|${segment}`;
      const streams = await probeStreams(joined);
      const first = await firstVideoPacket(joined);

      expect(keyframes.length).toBeGreaterThan(1);
      expect(streams.map((stream) => [stream.codec_name, stream.codec_tag_string])).toEqual([["av1", "av01"], ["aac", "mp4a"]]);
      expect(first.keyframe).toBe(true);
      expect(Math.abs(first.time - PASSTHROUGH_TIMESTAMP_OFFSET - (keyframes[1] ?? Number.NaN))).toBeLessThan(0.3);
    } finally {
      producer.kill();
      expect(await producer.exited).toBe(0);
    }
  });
}, 30_000);
