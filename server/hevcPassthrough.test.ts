import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audioTracks } from "./audioTracks.ts";
import { passthroughPlaylist, sourceKeyframes, startPassthrough } from "./hlsPassthrough.ts";
import { PASSTHROUGH_TIMESTAMP_OFFSET } from "./hlsTranscode.ts";
import { rewritePlaylist } from "./hlsPlaylist.ts";
import { playbackPlan } from "./playbackReadiness.ts";

let root = "";
let options = { mediaDir: "", mediaRoot: "", videoExtensions: new Set([".mkv"]), hardwareAcceleration: "" };
const rel = "Passthrough show/hevc-10bit.mkv";
// Irregular, like real releases: nothing lands on a fixed grid.
const KEYFRAMES = [0, 2.7, 5.9, 8.3, 11.6, 14.2, 17.5];
const DURATION = 20;

async function run(command: readonly string[]): Promise<string> {
  const proc = Bun.spawn([...command], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (code !== 0) {
    throw new Error(`${command[0] ?? ""} failed: ${err}`);
  }
  return out;
}

function probeSegment(init: string, segment: string, entries: string): Promise<string> {
  return run(["ffprobe", "-v", "error", "-show_entries", entries, "-of", "csv=p=0", `concat:${init}|${segment}`]);
}

/** The segment's first keyframe (first packet in decode order). */
async function segmentKeyframe(init: string, segment: string): Promise<number> {
  const out = await run([
    "ffprobe", "-v", "error", "-select_streams", "v:0", "-read_intervals", "%+#1",
    "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", `concat:${init}|${segment}`,
  ]);
  expect(out).toContain("K");
  return Number(out.split(",")[0]) - PASSTHROUGH_TIMESTAMP_OFFSET;
}

beforeAll(async () => {
  const created = await mkdtemp(join(tmpdir(), "nanime-hevc-passthrough-"));
  root = await realpath(created);
  options = { ...options, mediaDir: root, mediaRoot: root };
  await run(["mkdir", "-p", join(root, "Passthrough show")]);
  await run([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `testsrc2=size=320x180:rate=24000/1001:duration=${String(DURATION)}`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${String(DURATION)}`,
    "-map", "0:v", "-map", "1:a",
    "-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-x265-params", "log-level=error:scenecut=0",
    "-force_key_frames", KEYFRAMES.join(","), "-g", "1000", "-c:a", "aac", "-ac", "2",
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
  const directory = await mkdtemp(join(tmpdir(), "nanime-passthrough-session-"));
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
    const streams = await probeSegment(init, later, "stream=codec_name,codec_tag_string");
    expect(streams.trim().split("\n")).toEqual(["hevc,hvc1", "aac,mp4a"]);
    expect(await producer.segmentPath("segment-000099.m4s")).toBeNull();
  } finally {
    producer.kill();
    expect(await producer.exited).toBe(0);
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("probed keyframes survive a restart without reading the episode again", async () => {
  const abs = join(root, rel);
  const probed = await sourceKeyframes(abs);
  const module = join(import.meta.dir, "hlsPassthrough.ts");
  // A fresh process with no ffprobe on PATH can only answer from the stored probe.
  const script = `const { sourceKeyframes } = await import(${JSON.stringify(module)}); console.log(JSON.stringify(await sourceKeyframes(${JSON.stringify(abs)})));`;
  const proc = Bun.spawn([process.execPath, "-e", script], { env: { ...process.env, PATH: "/nonexistent" }, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

  expect({ code, err }).toEqual({ code: 0, err: "" });
  expect(JSON.parse(out)).toEqual([...probed]);
});
