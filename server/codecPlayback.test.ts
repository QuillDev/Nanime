import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PASSTHROUGH_TIMESTAMP_OFFSET } from "./hlsTranscode.ts";
import { getJson, startLibraryTestServer, viewerCookie, type LibraryTestServer } from "./libraryFilesTestServer.ts";
import { firstVideoPacket, makeClip, probeStreams, type FirstPacket, type ProbedStream } from "./testMedia.ts";
import { runBun, withTemporaryDirectory } from "./testProcess.ts";

// Irregular, like real releases: nothing lands on a fixed grid.
const HEVC_KEYFRAMES = [0, 2.7, 5.9, 8.3, 11.6, 14.2, 17.5];
const HEVC = "Codec Show/hevc-10bit.mkv";
const AV1 = "Codec Show/av1-10bit.mkv";
const STORED = "Codec Show/hevc-to-store.mkv";
let server: LibraryTestServer | null = null;
let viewer = "";

beforeAll(async () => {
  server = await startLibraryTestServer(async (media) => {
    await mkdir(join(media, "Codec Show"));
    const tenBitHevc = ["-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le"];
    await Promise.all([
      makeClip(join(media, HEVC), {
        seconds: 20, rate: "24000/1001", audio: ["jpn"], channels: 2,
        video: [...tenBitHevc, "-x265-params", "log-level=error:scenecut=0", "-force_key_frames", HEVC_KEYFRAMES.join(","), "-g", "1000"],
      }),
      // Like real AV1 releases: 10-bit video with Opus audio in Matroska.
      makeClip(join(media, AV1), {
        seconds: 12, rate: "24000/1001", audio: ["jpn"], audioCodec: "libopus", channels: 2,
        video: ["-c:v", "libsvtav1", "-preset", "12", "-pix_fmt", "yuv420p10le", "-g", "72"],
      }),
      makeClip(join(media, STORED), { seconds: 9, audio: ["jpn", "eng"], video: [...tenBitHevc, "-x265-params", "log-level=error"] }),
    ]);
  });
  viewer = await viewerCookie(server);
}, 90_000);

afterAll(async () => {
  await server?.close();
});

function target(): LibraryTestServer {
  if (server === null) {
    throw new Error("Test server is not running");
  }
  return server;
}

function get(path: string): Promise<Response> {
  return target().request(path, { cookie: viewer });
}

async function ready(path: string, client: { readonly hevc?: boolean; readonly av1?: boolean } = {}): Promise<boolean> {
  const response = await target().request("/api/playback-readiness", {
    method: "POST", json: { paths: [path], ...client }, cookie: viewer,
  });
  const body = await response.json() as { readonly items: readonly { readonly ready: boolean }[] };
  return body.items[0]?.ready ?? false;
}

async function playlist(params: Record<string, string>): Promise<{ readonly text: string; readonly urls: readonly string[] }> {
  const response = await get(`/hls/index?${new URLSearchParams(params).toString()}`);
  expect(response.status).toBe(200);
  const text = await response.text();
  const map = /URI="(?<uri>[^"]+)"/u.exec(text)?.groups?.["uri"];
  const segments = text.split("\n").filter((line) => line.startsWith("/hls/seg?"));
  return { text, urls: map === undefined ? segments : [map, ...segments] };
}

interface Probed {
  readonly streams: readonly ProbedStream[];
  readonly first: FirstPacket;
}

/** Downloads the given segment URLs, joins them in order and probes the result like a player would. */
async function probeSegments(urls: readonly string[]): Promise<Probed> {
  const bodies = await Promise.all(urls.map(async (url) => {
    const response = await get(url);
    expect(response.status).toBe(200);
    return new Uint8Array(await response.arrayBuffer());
  }));
  return await withTemporaryDirectory("nanime-codec-segments-", async (directory) => {
    const files = await Promise.all(bodies.map(async (body, index) => {
      const file = join(directory, `part-${String(index)}`);
      await writeFile(file, body);
      return file;
    }));
    const joined = `concat:${files.join("|")}`;
    return { streams: await probeStreams(joined), first: await firstVideoPacket(joined) };
  });
}

function codecs(streams: readonly ProbedStream[]): readonly (readonly [string, string | undefined])[] {
  return streams.map((stream) => [stream.codec_name, stream.codec_tag_string] as const);
}

test("10-bit HEVC and AV1 play untouched only on clients that decode them", async () => {
  expect(await ready(HEVC, { hevc: true })).toBe(true);
  expect(await ready(HEVC)).toBe(false);
  expect(await ready(AV1, { av1: true })).toBe(true);
  expect(await ready(AV1, { hevc: true })).toBe(false);
});

test("an HEVC client gets the whole episode as one segment per source keyframe, and any segment starts on its keyframe", async () => {
  const { text, urls } = await playlist({ path: HEVC, hevc: "1" });
  const [init = "", ...segments] = urls;
  expect(text).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
  expect(text).toContain("#EXT-X-ENDLIST");
  expect(init).toContain("name=init.mp4");
  expect(segments).toHaveLength(HEVC_KEYFRAMES.length);

  // Seek far ahead first, then back: both share the one init segment.
  const later = await probeSegments([init, segments[5] ?? ""]);
  const earlier = await probeSegments([init, segments[1] ?? ""]);
  expect(codecs(later.streams)).toEqual([["hevc", "hvc1"], ["aac", "mp4a"]]);
  expect(later.first.keyframe).toBe(true);
  // Within a few frames: MP4 may place a keyframe's presentation time by a different composition offset.
  expect(Math.abs(later.first.time - PASSTHROUGH_TIMESTAMP_OFFSET - 14.2)).toBeLessThan(0.3);
  expect(Math.abs(earlier.first.time - PASSTHROUGH_TIMESTAMP_OFFSET - 2.7)).toBeLessThan(0.3);
}, 30_000);

test("an AV1 client gets av01 video with browser-safe audio, starting on a keyframe", async () => {
  const { urls } = await playlist({ path: AV1, av1: "1" });
  const [init = "", , second = ""] = urls;
  const probed = await probeSegments([init, second]);

  expect(codecs(probed.streams)).toEqual([["av1", "av01"], ["aac", "mp4a"]]);
  expect(probed.first.keyframe).toBe(true);
}, 30_000);

test("probed keyframes survive a restart without reading the episode again", async () => {
  await playlist({ path: HEVC, hevc: "1" });
  // A fresh process with no ffprobe on PATH can only answer from the stored probe.
  const abs = join(target().media, HEVC);
  const script = `const { sourceKeyframes } = await import("./server/hlsPassthrough.ts"); console.log(JSON.stringify(await sourceKeyframes(${JSON.stringify(abs)})));`;
  const restarted = await runBun(["--eval", script], { ...process.env, PATH: "/nonexistent" });

  expect({ code: restarted.code, error: restarted.error }).toEqual({ code: 0, error: "" });
  expect(JSON.parse(restarted.output)).toHaveLength(HEVC_KEYFRAMES.length);
}, 30_000);

interface TranscodeJob { readonly sourcePath: string; readonly status: string }

async function waitUntilReady(path: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const playable = await ready(path);
    if (playable) {
      return;
    }
    const jobs = await getJson<readonly TranscodeJob[]>(target(), "/api/transcodes");
    expect(jobs.find((job) => job.sourcePath === path)?.status).not.toBe("failed");
    await Bun.sleep(250);
  }
  throw new Error(`${path} never became playable`);
}

test("an admin's stored transcode makes 10-bit HEVC playable everywhere, seekable on segment boundaries with every audio track", async () => {
  expect(await ready(STORED)).toBe(false);
  const queued = await target().request("/api/transcodes/bulk", { method: "POST", json: { paths: [STORED], preset: "compatibility" } });
  expect(queued.status).toBe(201);

  await waitUntilReady(STORED);
  const jobs = await getJson<readonly TranscodeJob[]>(target(), "/api/transcodes");
  expect(jobs.filter((job) => job.sourcePath === STORED).map((job) => job.status)).toEqual(["complete"]);

  // Played from the stored copy without re-encoding, a seek can only land exactly if keyframes sit on the boundaries.
  const { urls } = await playlist({ path: STORED, start: "4" });
  const [first = ""] = urls;
  expect(first).toContain("name=segment-000002.ts");
  const probed = await probeSegments([first]);
  expect(probed.streams.map((stream) => stream.codec_name)).toEqual(["h264", "aac"]);
  expect(probed.first.time).toBeGreaterThanOrEqual(4);
  expect(probed.first.time - 4).toBeLessThan(0.05);

  const english = await playlist({ path: STORED, audio: "2" });
  const englishSegment = await probeSegments(english.urls.slice(0, 1));
  expect(englishSegment.streams.map((stream) => stream.codec_type)).toEqual(["video", "audio"]);
}, 120_000);
