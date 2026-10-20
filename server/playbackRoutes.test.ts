import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startLibraryTestServer, statusOf, viewerCookie, type LibraryTestServer } from "./libraryFilesTestServer.ts";
import { firstVideoPacket, makeClip, probeStreams } from "./testMedia.ts";
import { withTemporaryDirectory } from "./testProcess.ts";

const H264 = "Clip Show/Clip Show - 01.mkv";
const HEVC_10BIT = "Clip Show/Clip Show - 02.mkv";
const SIDECAR = `1
00:00:01,000 --> 00:00:03,000
Gone before the restart

2
00:00:05,000 --> 00:00:08,000
Spans the restart

3
00:00:09,000 --> 00:00:10,500
After the restart
`;
let server: LibraryTestServer | null = null;
let viewer = "";

beforeAll(async () => {
  server = await startLibraryTestServer(async (media) => {
    await mkdir(join(media, "Clip Show"));
    await makeClip(join(media, H264), { seconds: 12, audio: ["eng", "jpn"] });
    await writeFile(join(media, "Clip Show/Clip Show - 01.en.srt"), SIDECAR);
    await makeClip(join(media, HEVC_10BIT), {
      seconds: 2, audio: ["jpn"], video: ["-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le", "-x265-params", "log-level=error"],
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

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return target().request(path, { headers, cookie: viewer });
}

function statusAt(path: string): Promise<number> {
  return statusOf(get(path));
}

async function json<T>(path: string): Promise<T> {
  const response = await get(path);
  expect(response.status).toBe(200);
  return await response.json() as T;
}

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/** Writes a response body to a temporary file and runs `read` on it. */
async function inspect<T>(response: Response, name: string, read: (path: string) => Promise<T>): Promise<T> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return await withTemporaryDirectory("nanime-route-body-", async (directory) => {
    await writeFile(join(directory, name), bytes);
    return await read(join(directory, name));
  });
}

interface Playlist {
  readonly status: number;
  readonly session: string | null;
  readonly start: number;
  readonly segments: readonly string[];
}

async function playlist(params: Record<string, string>): Promise<Playlist> {
  const response = await get(`/hls/index?${query(params)}`);
  const text = await response.text();
  return {
    status: response.status,
    session: response.headers.get("x-nanime-hls-session"),
    start: Number(response.headers.get("x-nanime-hls-start")),
    segments: text.split("\n").filter((line) => line.startsWith("/hls/seg?")),
  };
}

interface Readiness { readonly items: readonly { readonly path: string; readonly ready: boolean }[] }

test("a viewer can tell which episodes play now: browser-safe H.264 yes, 10-bit HEVC only after a transcode", async () => {
  const response = await target().request("/api/playback-readiness", {
    method: "POST", json: { paths: [H264, HEVC_10BIT] }, cookie: viewer,
  });
  expect(response.status).toBe(200);
  const readiness = await response.json() as Readiness;
  expect(readiness.items.map(({ path, ready }) => ({ path, ready }))).toEqual([
    { path: H264, ready: true }, { path: HEVC_10BIT, ready: false },
  ]);

  expect(await statusAt(`/hls/index?${query({ path: HEVC_10BIT })}`)).toBe(409);
});

interface AudioTrackInfo { readonly language: string | null; readonly isDefault: boolean }
interface SubtitleTrackInfo { readonly index: number; readonly language: string | null }

test("episode details list its duration, audio tracks and subtitles, and subtitles restart with the stream", async () => {
  const info = await json<{ readonly duration: number }>(`/api/media-info?${query({ path: H264 })}`);
  expect(Math.round(info.duration)).toBe(12);

  const audio = await json<readonly AudioTrackInfo[]>(`/api/audio-tracks?${query({ path: H264 })}`);
  expect(audio.map(({ language, isDefault }) => ({ language, isDefault }))).toEqual([
    { language: "eng", isDefault: true }, { language: "jpn", isDefault: false },
  ]);

  const subtitles = await json<readonly SubtitleTrackInfo[]>(`/api/subtitles?${query({ path: H264 })}`);
  expect(subtitles.map((track) => track.language)).toEqual(["en"]);
  // A stream restarted at 6 s starts its own clock at zero; subtitles follow it.
  const shifted = await get(`/subtitle?${query({ path: H264, index: String(subtitles[0]?.index), offset: "6" })}`);
  expect(shifted.status).toBe(200);
  const cues = await shifted.text();
  expect(cues.startsWith("WEBVTT")).toBe(true);
  expect(cues).not.toContain("Gone before the restart");
  expect(cues).toContain("00:00:00.000 --> 00:00:02.000\nSpans the restart");
  expect(cues).toContain("00:00:03.000 --> 00:00:04.500\nAfter the restart");
});

test("direct playback serves exactly the requested byte range of the episode", async () => {
  const file = await readFile(join(target().media, H264));
  const response = await get(`/stream?${query({ path: H264 })}`, { range: "bytes=100-199" });

  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe(`bytes 100-199/${String(file.byteLength)}`);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(file.subarray(100, 200)));

  const size = file.byteLength;
  const ranges = [
    { range: "bytes=-10", status: 206, contentRange: `bytes ${String(size - 10)}-${String(size - 1)}/${String(size)}` },
    { range: `bytes=-${String(size * 2)}`, status: 206, contentRange: `bytes 0-${String(size - 1)}/${String(size)}` },
    { range: `bytes=${String(size)}-`, status: 416, contentRange: `bytes */${String(size)}` },
    { range: "bytes=20-10", status: 416, contentRange: `bytes */${String(size)}` },
    { range: "bytes=0-1,5-6", status: 416, contentRange: `bytes */${String(size)}` },
    { range: "items=0-1", status: 416, contentRange: `bytes */${String(size)}` },
  ];
  const answered = await Promise.all(ranges.map(async ({ range }) => {
    const ranged = await get(`/stream?${query({ path: H264 })}`, { range });
    await ranged.arrayBuffer();
    return { range, status: ranged.status, contentRange: ranged.headers.get("content-range") };
  }));
  expect(answered).toEqual(ranges);

  // A player resuming a download of an older version of the file must start over, not splice two files.
  const stale = await get(`/stream?${query({ path: H264 })}`, { range: "bytes=100-", "if-range": "\"direct-replaced-file\"" });
  expect(stale.status).toBe(200);
  const restarted = await stale.arrayBuffer();
  expect(restarted.byteLength).toBe(file.byteLength);
});

test("managed playback returns playable H.264 segments, only to the viewer who asked", async () => {
  const opened = await playlist({ path: H264 });
  expect(opened.status).toBe(200);
  // The first playlist waits until playback can run past its first segment.
  expect(opened.segments.length).toBeGreaterThanOrEqual(3);
  const [first = ""] = opened.segments;

  const segment = await get(first);
  expect(segment.status).toBe(200);
  const streams = await inspect(segment, "segment.ts", probeStreams);
  expect(streams.map((stream) => [stream.codec_type, stream.codec_name])).toEqual([["video", "h264"], ["audio", "aac"]]);

  const traversal = first.replace(/name=[^&]+/u, "name=..%2Findex.m3u8");
  expect(await statusAt(traversal)).toBe(400);
  expect(await statusOf(target().request(first, { cookie: null }))).toBe(401);
  // Another signed-in user (the admin) cannot read this viewer's session.
  expect(await statusOf(target().request(first))).toBe(404);
}, 30_000);

test("seeking starts the stream on the segment boundary at or before the requested time", async () => {
  const resumed = await playlist({ path: H264, start: "7" });
  expect(resumed.status).toBe(200);
  expect(resumed.start).toBe(6);
  const [first = ""] = resumed.segments;
  expect(first).toContain("name=segment-000003.ts");
  const packet = await inspect(await get(first), "segment.ts", firstVideoPacket);
  expect(packet.time).toBeGreaterThanOrEqual(6);
  expect(packet.time - 6).toBeLessThan(0.05);

  expect(await statusAt(`/hls/index?${query({ path: H264, start: "-1" })}`)).toBe(400);
  expect(await statusAt(`/hls/index?${query({ path: H264, audio: "-1" })}`)).toBe(400);
}, 30_000);

test("players opening the same stretch of an episode at once share one encoder session", async () => {
  const [first, second] = await Promise.all([
    playlist({ path: H264, start: "8" }), playlist({ path: H264, start: "9" }),
  ]);
  expect([first.status, second.status]).toEqual([200, 200]);
  expect(first.session).not.toBeNull();
  expect(second.session).toBe(first.session);
}, 30_000);

const PLAYER = "6f1c2a52-0000-4000-8000-000000000001";
const OTHER_PLAYER = "6f1c2a52-0000-4000-8000-000000000002";
const LEASES = ["6f1c2a52-0000-4000-8000-0000000000a1", "6f1c2a52-0000-4000-8000-0000000000a2", "6f1c2a52-0000-4000-8000-0000000000a3"] as const;

test("a player's newer lease ends its older one, and releasing a lease stops only that player", async () => {
  const lease = (id: string) => ({ path: H264, start: "4", player: PLAYER, lease: id });
  const older = await playlist(lease(LEASES[0]));
  const [olderSegment = ""] = older.segments;
  expect(older.status).toBe(200);
  expect(await statusOf(get(olderSegment))).toBe(200);

  const newer = await playlist(lease(LEASES[1]));
  const [newerSegment = ""] = newer.segments;
  expect(newer.status).toBe(200);
  expect(await statusOf(get(olderSegment))).toBe(404);
  const endedLease = `/hls/index?${query(lease(LEASES[0]))}`;
  expect(await statusAt(endedLease)).toBe(410);
  expect(await statusOf(get(newerSegment))).toBe(200);

  // A second player watching the same stretch shares the encoder; releasing the first must not stop it.
  const other = await playlist({ ...lease(LEASES[2]), player: OTHER_PLAYER });
  const [otherSegment = ""] = other.segments;
  expect(other.session).toBe(newer.session);

  const release = await target().request(`/api/hls/release?${query({ player: PLAYER, lease: LEASES[1] })}`, { method: "POST", cookie: viewer });
  expect(await release.json()).toEqual({ released: true });
  expect(await statusAt(newerSegment)).toBe(404);
  expect(await statusAt(otherSegment)).toBe(200);

  const last = await target().request(`/api/hls/release?${query({ player: OTHER_PLAYER, lease: LEASES[2] })}`, { method: "POST", cookie: viewer });
  expect(await last.json()).toEqual({ released: true });
  expect(await statusAt(otherSegment)).toBe(404);
}, 30_000);

interface TrickplayManifest {
  readonly status: string;
  readonly version?: string;
  readonly sheetCount?: number;
}

async function readyManifest(): Promise<TrickplayManifest> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await get(`/api/trickplay?${query({ path: H264 })}`);
    const manifest = await response.json() as TrickplayManifest;
    if (response.status === 200) {
      return manifest;
    }
    expect(manifest.status).toBe("generating");
    await Bun.sleep(200);
  }
  throw new Error("Trickplay sheets were never generated");
}

test("scrubbing previews: a single frame right away, then a 5x5 sheet of 240x136 tiles", async () => {
  const frame = await get(`/trickplay/frame?${query({ path: H264, time: "3" })}`);
  expect(frame.status).toBe(200);
  expect(await inspect(frame, "frame.jpg", probeStreams)).toMatchObject([{ codec_name: "mjpeg", width: 240, height: 136 }]);

  const manifest = await readyManifest();
  expect(manifest.sheetCount).toBe(1);
  const sheet = await get(`/trickplay/sheet?${query({ path: H264, version: manifest.version ?? "", index: "0" })}`);
  expect(sheet.status).toBe(200);
  expect(await inspect(sheet, "sheet.jpg", probeStreams)).toMatchObject([{ codec_name: "mjpeg", width: 1200, height: 680 }]);
  expect(await statusAt(`/trickplay/sheet?${query({ path: H264, version: "stale", index: "0" })}`)).toBe(404);

  const thumbnail = await get(`/thumbnail?${query({ path: H264 })}`);
  expect(thumbnail.status).toBe(200);
  expect(await inspect(thumbnail, "thumbnail.jpg", probeStreams)).toMatchObject([{ codec_name: "mjpeg", width: 640 }]);
}, 60_000);
