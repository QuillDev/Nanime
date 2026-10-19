import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audioTracks } from "./audioTracks.ts";
import { passthroughSessionStart, rewritePlaylist } from "./hlsPlaylist.ts";
import { transcodeArgs } from "./hlsTranscode.ts";
import { playbackPlan } from "./playbackReadiness.ts";

let root = "";
let options = { mediaDir: "", mediaRoot: "", videoExtensions: new Set([".mkv"]), hardwareAcceleration: "" };
const rel = "Passthrough show/hevc-10bit.mkv";

async function run(command: readonly string[]): Promise<string> {
  const proc = Bun.spawn([...command], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (code !== 0) {
    throw new Error(`${command[0] ?? ""} failed: ${err}`);
  }
  return out;
}

/** The last source keyframe at or before `time`. */
async function keyframeBefore(path: string, time: number): Promise<number | undefined> {
  const out = await run([
    "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags",
    "-of", "csv=p=0", path,
  ]);
  const keyframes = out.trim().split("\n").filter((line) => line.includes("K"));
  const times = keyframes.map((line) => Number(line.split(",")[0]));
  return times.findLast((keyframe) => keyframe <= time);
}

beforeAll(async () => {
  const created = await mkdtemp(join(tmpdir(), "nanime-hevc-passthrough-"));
  root = await realpath(created);
  options = { ...options, mediaDir: root, mediaRoot: root };
  await run(["mkdir", "-p", join(root, "Passthrough show")]);
  // Irregular keyframes, like real releases: nothing lands on a 2 s grid.
  await run([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24000/1001:duration=9",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=9",
    "-map", "0:v", "-map", "1:a",
    "-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-x265-params", "log-level=error:scenecut=0",
    "-force_key_frames", "0,3.3,7.1", "-g", "1000", "-c:a", "aac", "-ac", "2",
    join(root, rel),
  ]);
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

test("a passthrough session starts on the source keyframe before the requested time and reports it", async () => {
  const abs = join(root, rel);
  const directory = await mkdtemp(join(tmpdir(), "nanime-passthrough-session-"));
  try {
    const [audioTrack] = await audioTracks(abs);
    await run(["ffmpeg", ...transcodeArgs({
      abs, audioTrack, directory, duration: 9, hardwareAcceleration: "", vaapiDevice: "",
      segmentIndex: 2, start: 4, source: { input: abs, videoMode: "passthrough" },
    })]);
    const playlist = await readFile(join(directory, "index.m3u8"), "utf8");
    const keyframe = await keyframeBefore(abs, 4);

    const start = await passthroughSessionStart(directory, playlist);
    expect(keyframe).toBeGreaterThan(3);
    // Within a frame: muxers may shift the first presentation time by a composition offset.
    expect(Math.abs((start ?? Number.NaN) - (keyframe ?? Number.NaN))).toBeLessThan(0.05);
    const streams = await run([
      "ffprobe", "-v", "error", "-show_entries", "stream=codec_name,codec_tag_string", "-of", "csv=p=0",
      `concat:${join(directory, "init.mp4")}|${join(directory, "segment-000002.m4s")}`,
    ]);
    expect(streams.trim().split("\n")).toEqual(["hevc,hvc1", "aac,mp4a"]);
    expect(rewritePlaylist(playlist, "session")).toContain(
      "#EXT-X-MAP:URI=\"/hls/seg?session=session&name=init.mp4\"",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
