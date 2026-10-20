import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startLibraryTestServer, viewerCookie, type LibraryTestServer } from "./libraryFilesTestServer.ts";
import { makeClip, probeStreams } from "./testMedia.ts";
import { withTemporaryDirectory } from "./testProcess.ts";

const H264 = "Clip Show/Clip Show - 01.mkv";
const HEVC_10BIT = "Clip Show/Clip Show - 02.mkv";
let server: LibraryTestServer | null = null;
let viewer = "";

beforeAll(async () => {
  server = await startLibraryTestServer(async (media) => {
    await mkdir(join(media, "Clip Show"));
    await makeClip(join(media, H264), { seconds: 6, audio: ["jpn"] });
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

interface Readiness { readonly items: readonly { readonly path: string; readonly ready: boolean }[] }

test("a viewer can tell which episodes play now: browser-safe H.264 yes, 10-bit HEVC only after a transcode", async () => {
  const response = await target().request("/api/playback-readiness", {
    method: "POST", body: JSON.stringify({ paths: [H264, HEVC_10BIT] }), cookie: viewer,
  });
  expect(response.status).toBe(200);
  const readiness = await response.json() as Readiness;
  expect(readiness.items.map(({ path, ready }) => ({ path, ready }))).toEqual([
    { path: H264, ready: true }, { path: HEVC_10BIT, ready: false },
  ]);

  const refused = await get(`/hls/index?path=${encodeURIComponent(HEVC_10BIT)}`);
  expect(refused.status).toBe(409);
});

test("direct playback serves exactly the requested byte range of the episode", async () => {
  const file = await readFile(join(target().media, H264));
  const response = await get(`/stream?path=${encodeURIComponent(H264)}`, { range: "bytes=100-199" });

  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe(`bytes 100-199/${String(file.byteLength)}`);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(file.subarray(100, 200)));
});

test("managed playback returns a playlist whose segments are playable H.264 video with the episode's audio", async () => {
  const playlist = await get(`/hls/index?path=${encodeURIComponent(H264)}`);
  expect(playlist.status).toBe(200);
  const lines = await playlist.text();
  const segments = lines.split("\n").filter((line) => line.startsWith("/hls/seg?"));
  expect(segments.length).toBeGreaterThan(0);

  const segment = await get(segments[0] ?? "");
  expect(segment.status).toBe(200);
  const streams = await withTemporaryDirectory("nanime-hls-route-", async (directory) => {
    const path = join(directory, "segment.ts");
    await writeFile(path, new Uint8Array(await segment.arrayBuffer()));
    return await probeStreams(path);
  });
  expect(streams.map((stream) => [stream.codec_type, stream.codec_name])).toEqual([["video", "h264"], ["audio", "aac"]]);

  const outsider = await target().request(segments[0] ?? "", { cookie: null });
  expect(outsider.status).toBe(401);
}, 30_000);
