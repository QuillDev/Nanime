import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getJson, startLibraryTestServer, statusOf, viewerCookie, type LibraryTestServer } from "./libraryFilesTestServer.ts";
import { makeClip, probeStreams, type ProbedStream } from "./testMedia.ts";
import { withTemporaryDirectory } from "./testProcess.ts";

const DUBBED = "Offline Show/Episode 01.mkv";
const NO_JAPANESE = "Offline Show/Episode 02.mkv";
const SILENT = "Offline Show/Episode 03.mkv";
let server: LibraryTestServer | null = null;
let viewer = "";

beforeAll(async () => {
  server = await startLibraryTestServer(async (media) => {
    await mkdir(join(media, "Offline Show"));
    await Promise.all([
      // English is the container default, as in most dual-audio releases.
      makeClip(join(media, DUBBED), { seconds: 3, audio: ["eng", "jpn"] }),
      makeClip(join(media, NO_JAPANESE), { seconds: 3, audio: ["eng", "kor"] }),
      makeClip(join(media, SILENT), { seconds: 2 }),
    ]);
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

function preferAudio(audioLanguage: string | null): Promise<Response> {
  return target().request("/api/auth/preferences", { method: "PUT", json: { audioLanguage }, cookie: viewer });
}

interface Artifact {
  readonly id: string;
  readonly status: string;
  readonly mediaUrl: string | null;
}

/** Asks for an offline copy and waits until it can be downloaded. */
async function prepare(path: string, audioIndex?: number): Promise<Artifact> {
  const response = await target().request("/api/offline-media", {
    method: "POST", body: JSON.stringify(audioIndex === undefined ? { path } : { path, audioIndex }), cookie: viewer,
  });
  expect([200, 202]).toContain(response.status);
  const created = await response.json() as Artifact;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const artifact = await getJson<Artifact>(target(), `/api/offline-media/${created.id}`, viewer);
    if (artifact.status === "ready") {
      return artifact;
    }
    expect(artifact.status).not.toBe("failed");
    await Bun.sleep(200);
  }
  throw new Error(`Offline copy of ${path} never became ready`);
}

interface Download {
  readonly bytes: Uint8Array;
  readonly streams: readonly ProbedStream[];
}

async function download(artifact: Artifact): Promise<Download> {
  const response = await target().request(artifact.mediaUrl ?? "", { cookie: viewer });
  expect(response.status).toBe(200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const streams = await withTemporaryDirectory("nanime-offline-download-", async (directory) => {
    await writeFile(join(directory, "episode.mp4"), bytes);
    return await probeStreams(join(directory, "episode.mp4"));
  });
  return { bytes, streams };
}

function audioLanguages(streams: readonly ProbedStream[]): readonly (string | undefined)[] {
  return streams.filter((stream) => stream.codec_type === "audio").map((stream) => stream.tags?.language);
}

test("an offline copy is a faststart H.264/AAC MP4 in the viewer's preferred audio language", async () => {
  expect(await statusOf(preferAudio("jpn"))).toBe(400);
  const saved = await preferAudio("ja");
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ username: "viewer", preferredAudioLanguage: "ja" });

  const { bytes, streams } = await download(await prepare(DUBBED));
  expect(streams.map((stream) => [stream.codec_type, stream.codec_name])).toEqual([["video", "h264"], ["audio", "aac"]]);
  expect(audioLanguages(streams)).toEqual(["jpn"]);
  expect(streams[1]?.channels).toBe(2);
  // Faststart: the index comes before the media data, so playback can begin before the download ends.
  const atoms = Buffer.from(bytes);
  expect(atoms.indexOf("moov")).toBeLessThan(atoms.indexOf("mdat"));
}, 60_000);

test("an explicit track beats the preference, a missing preference falls back to the default, and silence stays silent", async () => {
  expect(await statusOf(preferAudio("ja"))).toBe(200);
  const english = await download(await prepare(DUBBED, 1));
  expect(audioLanguages(english.streams)).toEqual(["eng"]);

  const fallback = await download(await prepare(NO_JAPANESE));
  expect(audioLanguages(fallback.streams)).toEqual(["eng"]);

  const silent = await download(await prepare(SILENT));
  expect(silent.streams.map((stream) => stream.codec_type)).toEqual(["video"]);

  const missing = await target().request("/api/offline-media", { method: "POST", json: { path: DUBBED, audioIndex: 9 }, cookie: viewer });
  expect(missing.status).toBe(404);
}, 60_000);

test("downloads resume with exact byte ranges, and a stale resume restarts from the beginning", async () => {
  const artifact = await prepare(DUBBED);
  const whole = await download(artifact);
  const first = await target().request(artifact.mediaUrl ?? "", { cookie: viewer });
  const etag = first.headers.get("etag") ?? "";
  await first.arrayBuffer();

  const resumed = await target().request(artifact.mediaUrl ?? "", { cookie: viewer, headers: { range: "bytes=100-", "if-range": etag } });
  expect(resumed.status).toBe(206);
  expect(resumed.headers.get("content-range")).toBe(`bytes 100-${String(whole.bytes.byteLength - 1)}/${String(whole.bytes.byteLength)}`);
  expect(new Uint8Array(await resumed.arrayBuffer())).toEqual(new Uint8Array(whole.bytes.subarray(100)));

  const stale = await target().request(artifact.mediaUrl ?? "", { cookie: viewer, headers: { range: "bytes=100-", "if-range": "\"another-version\"" } });
  expect(stale.status).toBe(200);
  const restarted = await stale.arrayBuffer();
  expect(restarted.byteLength).toBe(whole.bytes.byteLength);

  const unsatisfiable = await target().request(artifact.mediaUrl ?? "", { cookie: viewer, headers: { range: `bytes=${String(whole.bytes.byteLength)}-` } });
  expect(unsatisfiable.status).toBe(416);
}, 60_000);
