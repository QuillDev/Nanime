import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audioTracks } from "./audioTracks.ts";
import { sourceKeyframes, startPassthrough } from "./hlsPassthrough.ts";
import { PASSTHROUGH_TIMESTAMP_OFFSET } from "./hlsTranscode.ts";
import { playbackPlan } from "./playbackReadiness.ts";

let root = "";
let options = { mediaDir: "", mediaRoot: "", videoExtensions: new Set([".mkv"]), hardwareAcceleration: "" };
const rel = "AV1 show/av1-10bit.mkv";
const DURATION = 12;

async function run(command: readonly string[]): Promise<string> {
  const proc = Bun.spawn([...command], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (code !== 0) {
    throw new Error(`${command[0] ?? ""} failed: ${err}`);
  }
  return out;
}

beforeAll(async () => {
  const created = await mkdtemp(join(tmpdir(), "nanime-av1-passthrough-"));
  root = await realpath(created);
  options = { ...options, mediaDir: root, mediaRoot: root };
  await run(["mkdir", "-p", join(root, "AV1 show")]);
  // Like real AV1 releases: 10-bit video with Opus audio in Matroska.
  await run([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `testsrc2=size=320x180:rate=24000/1001:duration=${String(DURATION)}`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${String(DURATION)}`,
    "-map", "0:v", "-map", "1:a",
    "-c:v", "libsvtav1", "-preset", "12", "-pix_fmt", "yuv420p10le", "-g", "72",
    "-c:a", "libopus", "-ac", "2",
    join(root, rel),
  ]);
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
  const directory = await mkdtemp(join(tmpdir(), "nanime-av1-session-"));
  const [audioTrack] = await audioTracks(abs);
  const keyframes = await sourceKeyframes(abs);
  const producer = await startPassthrough({ input: abs, audioTrack, directory, duration: DURATION });
  try {
    const segment = await producer.segmentPath("segment-000001.m4s");
    const init = await producer.segmentPath("init.mp4");
    if (segment === null || init === null) {
      throw new Error("passthrough segments were not produced");
    }
    const streams = await run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,codec_tag_string", "-of", "csv=p=0", `concat:${init}|${segment}`]);
    const first = await run([
      "ffprobe", "-v", "error", "-select_streams", "v:0", "-read_intervals", "%+#1",
      "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", `concat:${init}|${segment}`,
    ]);

    expect(keyframes.length).toBeGreaterThan(1);
    expect(streams.trim().split("\n")).toEqual(["av1,av01", "aac,mp4a"]);
    expect(first).toContain("K");
    const start = Number(first.split(",")[0]) - PASSTHROUGH_TIMESTAMP_OFFSET;
    expect(Math.abs(start - (keyframes[1] ?? Number.NaN))).toBeLessThan(0.3);
  } finally {
    producer.kill();
    expect(await producer.exited).toBe(0);
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
