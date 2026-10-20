import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { audioTracks } from "./audioTracks.ts";
import { passthroughPlaylist, sourceKeyframes, startPassthrough } from "./hlsPassthrough.ts";
import { PASSTHROUGH_TIMESTAMP_OFFSET } from "./hlsTranscode.ts";
import { rewritePlaylist } from "./hlsPlaylist.ts";
import { playbackPlan } from "./playbackReadiness.ts";
import { firstVideoPacket, makeClip, probeStreams } from "./testMedia.ts";
import { runBun, temporaryDirectory, withTemporaryDirectory } from "./testProcess.ts";

let root = "";
let options = { mediaDir: "", mediaRoot: "", videoExtensions: new Set([".mkv"]), hardwareAcceleration: "" };
const rel = "Passthrough show/hevc-10bit.mkv";
// Irregular, like real releases: nothing lands on a fixed grid.
const KEYFRAMES = [0, 2.7, 5.9, 8.3, 11.6, 14.2, 17.5];
const DURATION = 20;

/** The segment's first keyframe (first packet in decode order) on the source timeline. */
async function segmentKeyframe(init: string, segment: string): Promise<number> {
  const first = await firstVideoPacket(`concat:${init}|${segment}`);
  expect(first.keyframe).toBe(true);
  return first.time - PASSTHROUGH_TIMESTAMP_OFFSET;
}

beforeAll(async () => {
  root = await temporaryDirectory("nanime-hevc-passthrough-");
  options = { ...options, mediaDir: root, mediaRoot: root };
  await mkdir(join(root, "Passthrough show"));
  await makeClip(join(root, rel), {
    seconds: DURATION, rate: "24000/1001", audio: ["jpn"], channels: 2,
    video: [
      "-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-x265-params", "log-level=error:scenecut=0",
      "-force_key_frames", KEYFRAMES.join(","), "-g", "1000",
    ],
  });
}, 60_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("10-bit HEVC streams untouched for clients that decode HEVC", async () => {
  const abs = join(root, rel);

  expect(await playbackPlan(abs, rel, { ...options, hevcClient: true }))
    .toEqual({ kind: "stream", source: { input: abs, videoMode: "passthrough" } });
  expect(await playbackPlan(abs, rel, options))
    .toEqual({ kind: "transcode-required", transcode: null });
});

test("the passthrough playlist lists the whole episode, one segment per source keyframe", async () => {
  const keyframes = await sourceKeyframes(join(root, rel));
  const playlist = passthroughPlaylist(keyframes, DURATION);

  expect(keyframes).toHaveLength(KEYFRAMES.length);
  expect(playlist.match(/^segment-\d{6}\.m4s$/gmu)).toHaveLength(KEYFRAMES.length);
  expect(playlist).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
  expect(playlist).toContain("#EXT-X-ENDLIST");
  expect(rewritePlaylist(playlist, "session")).toContain("#EXT-X-MAP:URI=\"/hls/seg?session=session&name=init.mp4\"");
});

test("seeking anywhere serves the segment that starts on that keyframe, sharing one init segment", async () => {
  const abs = join(root, rel);
  await withTemporaryDirectory("nanime-passthrough-session-", async (directory) => {
    const [audioTrack] = await audioTracks(abs);
    const keyframes = await sourceKeyframes(abs);
    const producer = await startPassthrough({ input: abs, audioTrack, directory, duration: DURATION });
    try {
      const later = await producer.segmentPath("segment-000005.m4s");
      const earlier = await producer.segmentPath("segment-000001.m4s");
      const init = await producer.segmentPath("init.mp4");
      if (later === null || earlier === null || init === null) {
        throw new Error("passthrough segments were not produced");
      }

      expect(await readFile(join(directory, "index.m3u8"), "utf8")).toContain("#EXT-X-ENDLIST");
      // Within a few frames: MP4 may place a keyframe's presentation time by a different composition offset.
      expect(Math.abs(await segmentKeyframe(init, later) - (keyframes[5] ?? Number.NaN))).toBeLessThan(0.3);
      expect(Math.abs(await segmentKeyframe(init, earlier) - (keyframes[1] ?? Number.NaN))).toBeLessThan(0.3);
      const streams = await probeStreams(`concat:${init}|${later}`);
      expect(streams.map((stream) => [stream.codec_name, stream.codec_tag_string])).toEqual([["hevc", "hvc1"], ["aac", "mp4a"]]);
      expect(await producer.segmentPath("segment-000099.m4s")).toBeNull();
    } finally {
      producer.kill();
      expect(await producer.exited).toBe(0);
    }
  });
}, 30_000);

test("probed keyframes survive a restart without reading the episode again", async () => {
  const abs = join(root, rel);
  const probed = await sourceKeyframes(abs);
  // A fresh process with no ffprobe on PATH can only answer from the stored probe.
  const script = `const { sourceKeyframes } = await import("./server/hlsPassthrough.ts"); console.log(JSON.stringify(await sourceKeyframes(${JSON.stringify(abs)})));`;
  const restarted = await runBun(["--eval", script], { ...process.env, PATH: "/nonexistent" });

  expect({ code: restarted.code, error: restarted.error }).toEqual({ code: 0, error: "" });
  expect(JSON.parse(restarted.output)).toEqual([...probed]);
});
