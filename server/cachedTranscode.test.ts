import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHED_TIMESTAMP_OFFSET } from "./hlsTranscode.ts";
import { startLibraryTestServer, viewerCookie, type LibraryTestServer } from "./libraryFilesTestServer.ts";
import { firstVideoPacket, makeClip, probeStreams, runText } from "./testMedia.ts";
import { withTemporaryDirectory } from "./testProcess.ts";

// 10-bit HEVC with keyframes off the 2 s grid, like a real release a browser can't play.
const EPISODE = "Cache Show/Cache Show - 01.mkv";
const SEGMENTS = 10;
// Browser-safe H.264: plays as it is unless the viewer asks for the converted stream.
const H264_EPISODE = "Cache Show/Cache Show - 02.mkv";
let server: LibraryTestServer | null = null;
let viewer = "";

beforeAll(async () => {
  server = await startLibraryTestServer(async (media) => {
    await mkdir(join(media, "Cache Show"));
    await makeClip(join(media, EPISODE), {
      seconds: 20, rate: "24000/1001", audio: ["jpn"], channels: 2,
      video: ["-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le", "-x265-params", "log-level=error:scenecut=0", "-force_key_frames", "0,2.7,5.9,8.3,11.6,14.2,17.5", "-g", "1000"],
    });
    await makeClip(join(media, H264_EPISODE), {
      seconds: 20, rate: "24000/1001", audio: ["jpn"], channels: 2,
      video: ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "48"],
    });
  });
  viewer = await viewerCookie(server);
}, 60_000);

afterAll(async () => {
  await server?.close();
});

function target(): LibraryTestServer {
  if (server === null) {
    throw new Error("Test server is not running");
  }
  return server;
}

async function segmentUrls(): Promise<readonly string[]> {
  const response = await target().request(`/hls/index?${new URLSearchParams({ path: EPISODE }).toString()}`, { cookie: viewer });
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
  expect(response.headers.get("x-nanime-hls-start")).toBe("0");
  return text.split("\n").filter((line) => line.startsWith("/hls/seg?"));
}

async function download(url: string): Promise<Uint8Array> {
  const response = await target().request(url, { cookie: viewer });
  expect(response.status).toBe(200);
  return new Uint8Array(await response.arrayBuffer());
}

/** Segments the library has kept for this episode. */
async function keptSegments(): Promise<readonly string[]> {
  const root = join(target().media, ".nanime-segments");
  const [episode] = await readdir(root).catch((): string[] => []);
  const names = episode === undefined ? [] : await readdir(join(root, episode));
  return names.filter((name) => name.endsWith(".ts")).toSorted();
}

async function waitForKept(count: number): Promise<readonly string[]> {
  const deadline = Date.now() + 30_000;
  let kept = await keptSegments();
  while (kept.length < count && Date.now() < deadline) {
    await Bun.sleep(100);
    kept = await keptSegments();
  }
  return kept;
}

async function packetTimes(path: string, stream: string): Promise<readonly number[]> {
  const out = await runText(["ffprobe", "-v", "error", "-select_streams", stream, "-show_entries", "packet=pts_time", "-of", "csv=p=0", path]);
  return out.trim().split("\n").map((line) => Number(line.replace(/,$/u, ""))).toSorted((left, right) => left - right);
}

function frameTimes(path: string): Promise<readonly number[]> {
  return packetTimes(path, "v:0");
}

test("a converted episode keeps what's watched: a seek converts from there, and a later start fills in and reuses it", async () => {
  const urls = await segmentUrls();
  expect(urls).toHaveLength(SEGMENTS);

  // Start watching at 12 s: segment 6 onward is converted, on the episode's own clock.
  const seeked = await download(urls[6] ?? "");
  const kept = await waitForKept(SEGMENTS - 6);
  expect(kept).toEqual(["segment-000006.ts", "segment-000007.ts", "segment-000008.ts", "segment-000009.ts"]);

  // Someone watches from the start: the first half is converted, the second half comes from disk.
  const whole = await Promise.all(urls.map((url) => download(url)));
  expect(await waitForKept(SEGMENTS)).toHaveLength(SEGMENTS);
  expect(whole[6]).toEqual(seeked);

  await withTemporaryDirectory("nanime-cached-segments-", async (directory) => {
    const files = await Promise.all(whole.map(async (body, index) => {
      const file = join(directory, `${String(index)}.ts`);
      await writeFile(file, body);
      return file;
    }));
    const joined = `concat:${files.join("|")}`;
    const streams = await probeStreams(joined);
    expect(streams.map((stream) => stream.codec_name)).toEqual(["h264", "aac"]);
    const seekedStart = await firstVideoPacket(files[6] ?? "");
    expect(seekedStart.keyframe).toBe(true);
    expect(seekedStart.time - CACHED_TIMESTAMP_OFFSET).toBeGreaterThanOrEqual(12);
    expect(seekedStart.time - CACHED_TIMESTAMP_OFFSET).toBeLessThan(12.05);
    // Pieces from two runs make one gapless, overlap-free episode: every source frame exactly once.
    const source = await frameTimes(join(target().media, EPISODE));
    const played = await frameTimes(joined);
    expect(played.length).toBe(source.length);
    const drift = played.map((time, index) => Math.abs(time - CACHED_TIMESTAMP_OFFSET - (source[index] ?? 0)));
    expect(Math.max(...drift)).toBeLessThan(0.01);
    // Audio is cut on the same boundaries: none of it repeats across pieces from different runs.
    const seekedAudio = await packetTimes(files[6] ?? "", "a:0");
    expect(seekedAudio[0] ?? 0).toBeGreaterThanOrEqual(CACHED_TIMESTAMP_OFFSET + 12 - 0.05);
    const audio = await packetTimes(joined, "a:0");
    const repeats = audio.filter((time, index) => index > 0 && time <= (audio[index - 1] ?? 0));
    expect(repeats).toEqual([]);
  });
  // What's on disk is what the first viewer got.
  const root = join(target().media, ".nanime-segments");
  const [episode = ""] = await readdir(root);
  const onDisk = await readFile(join(root, episode, "segment-000006.ts"));
  expect(onDisk.equals(seeked)).toBe(true);
}, 120_000);

interface ConvertedProgressBody {
  readonly duration: number;
  readonly kept: readonly (readonly [number, number])[];
  readonly converting: readonly (readonly [number, number])[];
}

async function convertedProgress(path: string): Promise<ConvertedProgressBody> {
  const response = await target().request(`/hls/converted?${new URLSearchParams({ path }).toString()}`, { cookie: viewer });
  expect(response.status).toBe(200);
  return await response.json() as ConvertedProgressBody;
}

test("a viewer can choose the converted stream over the original and see which parts are converted", async () => {
  const before = await convertedProgress(H264_EPISODE);
  expect(before.kept).toEqual([]);
  // A client that decodes everything, asking for the converted stream anyway.
  const response = await target().request(`/hls/index?${new URLSearchParams({ path: H264_EPISODE, hevc: "1", av1: "1", convert: "1" }).toString()}`, { cookie: viewer });
  expect(response.status).toBe(200);
  expect(response.headers.get("x-nanime-hls-passthrough")).toBeNull();
  const playlist = await response.text();
  const urls = playlist.split("\n").filter((line) => line.startsWith("/hls/seg?"));
  expect(urls).toHaveLength(SEGMENTS);

  const segment = await download(urls[3] ?? "");
  await withTemporaryDirectory("nanime-converted-choice-", async (directory) => {
    const file = join(directory, "3.ts");
    await writeFile(file, segment);
    const streams = await probeStreams(file);
    expect(streams.map((stream) => stream.codec_name)).toEqual(["h264", "aac"]);
  });
  // The run converts from the requested spot to the end, and the progress shows it fill in.
  const deadline = Date.now() + 30_000;
  let progress = await convertedProgress(H264_EPISODE);
  while (progress.kept[0]?.[1] !== progress.duration && Date.now() < deadline) {
    await Bun.sleep(100);
    progress = await convertedProgress(H264_EPISODE);
  }
  expect(progress.kept).toEqual([[6, progress.duration]]);
  expect(progress.converting).toEqual([]);
}, 60_000);
