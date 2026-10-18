import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HLS_SEGMENT_SECONDS } from "../shared/playback.ts";
import { transcodeArgs } from "./hlsTranscode.ts";
import { playbackPlan } from "./playbackReadiness.ts";
import { transcodeResponse } from "./transcodes.ts";

let root = "";
let options = { mediaDir: "", mediaRoot: "", videoExtensions: new Set([".mkv"]) };
const show = `Stored transcode ${String(process.pid)}`;
const tenBit = `${show}/hevc-10bit.mkv`;
const browserSafe = `${show}/h264.mkv`;

async function run(command: readonly string[]): Promise<string> {
  const proc = Bun.spawn([...command], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (code !== 0) {
    throw new Error(`${command[0] ?? ""} failed: ${err}`);
  }
  return out;
}

function clip(video: readonly string[], output: string): Promise<string> {
  return run([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24000/1001:duration=9",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=9",
    "-f", "lavfi", "-i", "sine=frequency=660:duration=9",
    "-map", "0:v", "-map", "1:a", "-map", "2:a", ...video, "-c:a", "aac", output,
  ]);
}

async function keyframeTimes(path: string): Promise<readonly number[]> {
  const out = await run([
    "ffprobe", "-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey",
    "-show_entries", "frame=pts_time", "-of", "csv=p=0", path,
  ]);
  return out.trim().split("\n").map((line) => Number(line.replace(/,$/u, "")));
}

async function waitForStream(rel: string): Promise<Awaited<ReturnType<typeof playbackPlan>>> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const plan = await playbackPlan(join(root, rel), rel, { ...options, hardwareAcceleration: "" });
    if (plan.kind === "stream") {
      return plan;
    }
    expect(plan.transcode?.status).not.toBe("failed");
    await Bun.sleep(250);
  }
  throw new Error("Stored transcode did not become streamable");
}

beforeAll(async () => {
  const created = await mkdtemp(join(tmpdir(), "nanime-stored-transcode-"));
  root = await realpath(created);
  options = { mediaDir: root, mediaRoot: root, videoExtensions: new Set([".mkv"]) };
  await run(["mkdir", "-p", join(root, show)]);
  await clip(["-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-x265-params", "log-level=error"], join(root, tenBit));
  await clip(["-c:v", "libx264", "-pix_fmt", "yuv420p"], join(root, browserSafe));
}, 60_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("browser-safe H.264 still streams through live encoding", async () => {
  const plan = await playbackPlan(join(root, browserSafe), browserSafe, { ...options, hardwareAcceleration: "" });
  expect(plan).toEqual({ kind: "stream", source: { input: join(root, browserSafe), videoMode: "encode" } });
});

test("10-bit HEVC must be transcoded, then streams its stored copy without re-encoding", async () => {
  const before = await playbackPlan(join(root, tenBit), tenBit, { ...options, hardwareAcceleration: "" });
  expect(before).toEqual({ kind: "transcode-required", transcode: null });

  const queued = await transcodeResponse(new Request("http://nanime.test/api/transcodes/bulk", {
    method: "POST", body: JSON.stringify({ paths: [tenBit], preset: "compatibility" }),
  }), "/api/transcodes/bulk", options);
  expect(queued.status).toBe(201);

  const plan = await waitForStream(tenBit);
  if (plan.kind !== "stream") {
    throw new Error("expected a stream plan");
  }
  expect(plan.source.videoMode).toBe("copy");
  expect(plan.source.input).not.toBe(join(root, tenBit));
  expect(await readdir(join(root, show))).toEqual(expect.arrayContaining(["hevc-10bit.mkv"]));

  const keyframes = await keyframeTimes(plan.source.input);
  for (let boundary = 0; boundary < 8; boundary += HLS_SEGMENT_SECONDS) {
    expect(keyframes.some((time) => time >= boundary && time - boundary < 0.05)).toBe(true);
  }
  const audio = await run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", plan.source.input]);
  expect(audio.trim().split("\n")).toHaveLength(2);
});

test("a copy session starts its first segment on the requested boundary", async () => {
  const plan = await waitForStream(tenBit);
  if (plan.kind !== "stream") {
    throw new Error("expected a stream plan");
  }
  const directory = await mkdtemp(join(tmpdir(), "nanime-copy-session-"));
  try {
    const start = 4;
    await run(["ffmpeg", ...transcodeArgs({
      abs: join(root, tenBit), audioTrack: undefined, directory, duration: 9,
      hardwareAcceleration: "", vaapiDevice: "", segmentIndex: start / HLS_SEGMENT_SECONDS, start,
      source: plan.source,
    })]);
    const first = await run([
      "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time",
      "-read_intervals", "%+#1", "-of", "csv=p=0", join(directory, "segment-000002.ts"),
    ]);
    const time = Number(first.trim().replace(/,$/u, ""));
    expect(time).toBeGreaterThanOrEqual(start);
    expect(time - start).toBeLessThan(0.05);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
