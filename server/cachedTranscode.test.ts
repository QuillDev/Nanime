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
let server: LibraryTestServer | null = null;
let viewer = "";

beforeAll(async () => {
  server = await startLibraryTestServer(async (media) => {
    await mkdir(join(media, "Cache Show"));
    await makeClip(join(media, EPISODE), {
      seconds: 20, rate: "24000/1001", audio: ["jpn"], channels: 2,
      video: ["-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le", "-x265-params", "log-level=error:scenecut=0", "-force_key_frames", "0,2.7,5.9,8.3,11.6,14.2,17.5", "-g", "1000"],
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

async function frameTimes(path: string): Promise<readonly number[]> {
  const out = await runText(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", path]);
  return out.trim().split("\n").map((line) => Number(line.replace(/,$/u, ""))).toSorted((left, right) => left - right);
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
  });
  // What's on disk is what the first viewer got.
  const root = join(target().media, ".nanime-segments");
  const [episode = ""] = await readdir(root);
  const onDisk = await readFile(join(root, episode, "segment-000006.ts"));
  expect(onDisk.equals(seeked)).toBe(true);
}, 120_000);
