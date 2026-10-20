import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { HLS_SEGMENT_SECONDS } from "../shared/playback.ts";
import { transcodeArgs } from "./hlsTranscode.ts";
import { playbackPlan } from "./playbackReadiness.ts";
import { firstVideoPacket, makeClip, probeStreams, run, runText } from "./testMedia.ts";
import { temporaryDirectory, withTemporaryDirectory } from "./testProcess.ts";
import { transcodeResponse } from "./transcodes.ts";

let root = "";
let options = { mediaDir: "", mediaRoot: "", videoExtensions: new Set([".mkv"]) };
const show = `Stored transcode ${String(process.pid)}`;
const tenBit = `${show}/hevc-10bit.mkv`;
const browserSafe = `${show}/h264.mkv`;

async function keyframeTimes(path: string): Promise<readonly number[]> {
  const out = await runText([
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
  root = await temporaryDirectory("nanime-stored-transcode-");
  options = { mediaDir: root, mediaRoot: root, videoExtensions: new Set([".mkv"]) };
  await mkdir(join(root, show));
  const clip = { seconds: 9, rate: "24000/1001", audio: ["jpn", "eng"] };
  await makeClip(join(root, tenBit), { ...clip, video: ["-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-x265-params", "log-level=error"] });
  await makeClip(join(root, browserSafe), { ...clip, video: ["-c:v", "libx264", "-pix_fmt", "yuv420p"] });
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
  const streams = await probeStreams(plan.source.input);
  expect(streams.filter((stream) => stream.codec_type === "audio")).toHaveLength(2);
});

test("a copy session starts its first segment on the requested boundary", async () => {
  const plan = await waitForStream(tenBit);
  if (plan.kind !== "stream") {
    throw new Error("expected a stream plan");
  }
  await withTemporaryDirectory("nanime-copy-session-", async (directory) => {
    const start = 4;
    await run(["ffmpeg", ...transcodeArgs({
      abs: join(root, tenBit), audioTrack: undefined, directory, duration: 9,
      hardwareAcceleration: "", vaapiDevice: "", segmentIndex: start / HLS_SEGMENT_SECONDS, start,
      source: plan.source,
    })]);
    const first = await firstVideoPacket(join(directory, "segment-000002.ts"));
    expect(first.time).toBeGreaterThanOrEqual(start);
    expect(first.time - start).toBeLessThan(0.05);
  });
});
