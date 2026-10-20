import { afterEach, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DownloadItem, DownloadStatus } from "../shared/types.ts";
import { getJson, startLibraryTestServer, statusOf, viewerCookie, type LibraryTestServer } from "./libraryFilesTestServer.ts";
import { makeClip, probeStreams, run } from "./testMedia.ts";
import { temporaryDirectory, waitUntil } from "./testProcess.ts";
import { SOURCE_HEADER, startFakeSource, type FakeSource } from "./testSource.ts";

const SHOW = "Lantern Ferry Club";
let server: LibraryTestServer | null = null;
let source: FakeSource | null = null;

afterEach(async () => {
  await server?.close();
  source?.stop();
  server = null;
  source = null;
});

interface DownloadList {
  readonly downloads: readonly DownloadStatus[];
  readonly torrentError: string | null;
}

async function start(env: Readonly<Record<string, string>> = {}): Promise<{ readonly target: LibraryTestServer; readonly site: FakeSource }> {
  server = await startLibraryTestServer(async () => {}, { env });
  source = await startFakeSource();
  return { target: server, site: source };
}

function episodeBytes(seed: number, size: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_value, index) => (index * 31 + seed) % 251);
}

function fileItem(site: FakeSource, path: string, fileName: string): DownloadItem {
  return { kind: "file", url: site.url(path), fileName, headers: SOURCE_HEADER };
}

function add(target: LibraryTestServer, showFolder: string, items: readonly unknown[]): Promise<Response> {
  return target.request("/api/downloads", { method: "POST", json: { showFolder, items } });
}

function list(target: LibraryTestServer): Promise<DownloadList> {
  return getJson<DownloadList>(target, "/api/downloads");
}

async function listed(target: LibraryTestServer): Promise<readonly DownloadStatus[]> {
  const { downloads } = await list(target);
  return downloads;
}

function addStatus(target: LibraryTestServer, showFolder: string, items: readonly unknown[]): Promise<number> {
  return statusOf(add(target, showFolder, items));
}

function control(target: LibraryTestServer, id: string, action: "pause" | "resume" | "cancel"): Promise<Response> {
  const init = action === "cancel" ? { method: "POST", json: { deleteFiles: true } } : { method: "POST" };
  return target.request(`/api/downloads/${encodeURIComponent(id)}/${action}`, init);
}

/** The one listed download, once `ready` accepts it. */
function waitForDownload(target: LibraryTestServer, ready: (download: DownloadStatus) => boolean): Promise<DownloadStatus> {
  return waitUntil("the download", async () => {
    const downloads = await listed(target);
    return downloads.find((download) => ready(download));
  });
}

function waitUntilFinished(target: LibraryTestServer): Promise<true> {
  return waitUntil("the downloads to finish", async () => {
    const { downloads } = await list(target);
    expect(downloads.filter((download) => download.state === "failed")).toEqual([]);
    return downloads.length === 0 ? true : undefined;
  }, 60_000);
}

async function libraryBytes(target: LibraryTestServer, name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(target.media, SHOW, name)));
}

async function partFiles(target: LibraryTestServer): Promise<readonly string[]> {
  return await readdir(join(target.media, ".nanime-downloads")).catch(() => []);
}

test("a season of direct links lands in the show folder, fetched with the source's headers", async () => {
  const { target, site } = await start();
  const first = episodeBytes(1, 300_000);
  const second = episodeBytes(2, 200_000);
  site.serve("/ep1.mkv", { bytes: first });
  site.serve("/ep2.mkv", { bytes: second });

  const response = await add(target, SHOW, [fileItem(site, "/ep1.mkv", `${SHOW} - 01.mkv`), fileItem(site, "/ep2.mkv", `${SHOW} - 02.mkv`)]);
  expect(await response.json()).toEqual({ added: 2 });
  await waitUntilFinished(target);

  expect(await libraryBytes(target, `${SHOW} - 01.mkv`)).toEqual(first);
  expect(await libraryBytes(target, `${SHOW} - 02.mkv`)).toEqual(second);
  expect(await partFiles(target)).toEqual([]);
  const inLibrary = await waitUntil("the library to list the episodes", async () => {
    const media = await getJson<readonly { readonly rel: string }[]>(target, "/api/list");
    return media.length === 2 ? media.map((entry) => entry.rel).toSorted() : undefined;
  });
  expect(inLibrary).toEqual([`${SHOW}/${SHOW} - 01.mkv`, `${SHOW}/${SHOW} - 02.mkv`]);
}, 60_000);

test("pausing keeps the partial file, and resuming continues from where it stopped", async () => {
  const { target, site } = await start();
  const bytes = episodeBytes(3, 400_000);
  site.serve("/slow.mkv", { bytes, throttle: { chunk: 8000, delayMs: 20 } });
  await add(target, SHOW, [fileItem(site, "/slow.mkv", `${SHOW} - 01.mkv`)]);

  const started = await waitForDownload(target, (download) => download.completed > 40_000);
  expect(started).toMatchObject({ kind: "file", name: `${SHOW} - 01.mkv`, showFolder: SHOW, state: "downloading", size: bytes.byteLength });
  expect(await statusOf(control(target, started.id, "pause"))).toBe(200);
  const paused = await waitForDownload(target, (download) => download.state === "paused");
  await Bun.sleep(300);
  const [still] = await listed(target);
  expect(still?.completed).toBe(paused.completed);

  expect(await statusOf(control(target, started.id, "resume"))).toBe(200);
  await waitUntilFinished(target);
  expect(await libraryBytes(target, `${SHOW} - 01.mkv`)).toEqual(bytes);
  const [first, resumed] = site.ranges("/slow.mkv");
  expect(first).toBeNull();
  expect(resumed).toMatch(/^bytes=[1-9]\d*-$/u);
}, 60_000);

test("a source that ignores ranges gets the file again from the start instead of a corrupted copy", async () => {
  const { target, site } = await start();
  const bytes = episodeBytes(9, 400_000);
  site.serve("/whole.mkv", { bytes, ranges: "ignored", throttle: { chunk: 8000, delayMs: 20 } });
  await add(target, SHOW, [fileItem(site, "/whole.mkv", `${SHOW} - 01.mkv`)]);
  const started = await waitForDownload(target, (download) => download.completed > 40_000);
  await control(target, started.id, "pause");
  await waitForDownload(target, (download) => download.state === "paused");

  site.serve("/whole.mkv", { bytes, ranges: "ignored" });
  await control(target, started.id, "resume");
  await waitUntilFinished(target);
  expect(await libraryBytes(target, `${SHOW} - 01.mkv`)).toEqual(bytes);
}, 60_000);

test("a source that answers a resume with the wrong part fails instead of splicing it in", async () => {
  const { target, site } = await start();
  const bytes = episodeBytes(11, 400_000);
  site.serve("/wrong.mkv", { bytes, throttle: { chunk: 8000, delayMs: 20 } });
  await add(target, SHOW, [fileItem(site, "/wrong.mkv", `${SHOW} - 01.mkv`)]);
  const started = await waitForDownload(target, (download) => download.completed > 40_000);
  await control(target, started.id, "pause");
  await waitForDownload(target, (download) => download.state === "paused");

  site.serve("/wrong.mkv", { bytes, ranges: "from-start" });
  await control(target, started.id, "resume");
  const failed = await waitForDownload(target, (download) => download.state === "failed");
  expect(failed.error).toBe("The source sent a different part of the file than was asked for");
  expect(await readdir(join(target.media, SHOW)).catch(() => [])).toEqual([]);
}, 60_000);

test("a source that answers in pieces is asked for the rest until the file is whole", async () => {
  const { target, site } = await start();
  const bytes = episodeBytes(10, 250_000);
  site.serve("/pieces.mkv", { bytes, pieceSize: 100_000 });
  await add(target, SHOW, [fileItem(site, "/pieces.mkv", `${SHOW} - 01.mkv`)]);
  await waitUntilFinished(target);

  expect(await libraryBytes(target, `${SHOW} - 01.mkv`)).toEqual(bytes);
  expect(site.ranges("/pieces.mkv")).toEqual([null, "bytes=100000-", "bytes=200000-"]);
}, 60_000);

test("a download interrupted by a crash continues after the restart", async () => {
  const { target, site } = await start();
  const bytes = episodeBytes(4, 400_000);
  site.serve("/crash.mkv", { bytes, throttle: { chunk: 8000, delayMs: 20 } });
  await add(target, SHOW, [fileItem(site, "/crash.mkv", `${SHOW} - 01.mkv`)]);
  await waitForDownload(target, (download) => download.completed > 40_000);

  await target.restart("crash");
  site.serve("/crash.mkv", { bytes });
  await waitUntilFinished(target);
  expect(await libraryBytes(target, `${SHOW} - 01.mkv`)).toEqual(bytes);
  expect(site.ranges("/crash.mkv").at(-1)).toMatch(/^bytes=[1-9]\d*-$/u);
}, 60_000);

test("an HLS stream is saved as one MP4 with its video and audio", async () => {
  const { target, site } = await start();
  const stream = await temporaryDirectory("nanime-hls-source-");
  const clip = await makeClip(join(stream, "clip.mp4"), { seconds: 4, audio: ["jpn"] });
  await run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", clip, "-c", "copy", "-f", "hls", "-hls_time", "1", "-hls_playlist_type", "vod", join(stream, "index.m3u8")]);
  site.serveDirectory("stream", stream);

  await add(target, SHOW, [fileItem(site, "/stream/index.m3u8", `${SHOW} - 01.mkv`)]);
  await waitUntilFinished(target);

  const streams = await probeStreams(join(target.media, SHOW, `${SHOW} - 01.mp4`));
  expect(streams.map((entry) => `${entry.codec_type}:${entry.codec_name}`)).toEqual(["video:h264", "audio:aac"]);
}, 60_000);

test("a failing source shows its error, and a retry after it recovers finishes the file", async () => {
  const { target, site } = await start();
  const bytes = episodeBytes(5, 50_000);
  site.serve("/flaky.mkv", { bytes });
  site.fail("/flaky.mkv", 503);
  await add(target, SHOW, [fileItem(site, "/flaky.mkv", `${SHOW} - 01.mkv`)]);

  const failed = await waitForDownload(target, (download) => download.state === "failed");
  expect(failed.error).toBe("The source answered 503");
  site.fail("/flaky.mkv", null);
  await control(target, failed.id, "resume");
  await waitUntilFinished(target);
  expect(await libraryBytes(target, `${SHOW} - 01.mkv`)).toEqual(bytes);
}, 60_000);

test("removing a direct download stops it and deletes its partial file", async () => {
  const { target, site } = await start();
  site.serve("/removed.mkv", { bytes: episodeBytes(6, 400_000), throttle: { chunk: 8000, delayMs: 20 } });
  await add(target, SHOW, [fileItem(site, "/removed.mkv", `${SHOW} - 01.mkv`)]);
  const started = await waitForDownload(target, (download) => download.completed > 0);

  expect(await statusOf(control(target, started.id, "cancel"))).toBe(200);
  expect(await listed(target)).toEqual([]);
  await Bun.sleep(200);
  expect(await partFiles(target)).toEqual([]);
  expect(await readdir(join(target.media, SHOW)).catch(() => [])).toEqual([]);
}, 60_000);

test("refuses taken names, non-HTTP links, non-video names, and non-admins", async () => {
  const { target, site } = await start();
  site.serve("/ep.mkv", { bytes: episodeBytes(7, 1000) });
  await add(target, SHOW, [fileItem(site, "/ep.mkv", `${SHOW} - 01.mkv`)]);
  await waitUntilFinished(target);

  const taken = fileItem(site, "/ep.mkv", `${SHOW} - 01.mkv`);
  const twice = fileItem(site, "/ep.mkv", "Twice.mkv");
  const episode = fileItem(site, "/ep.mkv", "a.mkv");
  expect(await addStatus(target, SHOW, [taken])).toBe(409);
  expect(await addStatus(target, SHOW, [twice, twice])).toBe(409);
  expect(await addStatus(target, SHOW, [{ kind: "file", url: "file:///etc/passwd", fileName: "a.mkv" }])).toBe(400);
  expect(await addStatus(target, SHOW, [fileItem(site, "/ep.mkv", "notes.txt")])).toBe(400);
  expect(await addStatus(target, "", [episode])).toBe(400);
  expect(await addStatus(target, "../outside", [episode])).toBe(400);
  const viewer = await viewerCookie(target);
  const forbidden = target.request("/api/downloads", { cookie: viewer });
  expect(await statusOf(forbidden)).toBe(403);
  expect(await listed(target)).toEqual([]);
}, 60_000);

const MAGNET = `magnet:?xt=urn:btih:${"ab".repeat(20)}&dn=${encodeURIComponent("[Group] Lantern Ferry Club S01")}`;

async function torrentRoundTrip(version: 4 | 5): Promise<readonly string[]> {
  server = await startLibraryTestServer(async () => {}, { qbittorrentVersion: version });
  const target = server;
  const added = await add(target, SHOW, [{ kind: "torrent", magnet: MAGNET }]);
  expect(await added.text()).toBe(JSON.stringify({ added: 1 }));
  expect(target.qbittorrent.torrents().map((torrent) => torrent.content)).toEqual([join(target.media, SHOW, "[Group] Lantern Ferry Club S01")]);

  const id = `torrent:${"ab".repeat(20)}`;
  const state = async (): Promise<string> => {
    const downloads = await listed(target);
    return downloads.find((download) => download.id === id)?.state ?? "gone";
  };
  const states = [await state()];
  await control(target, id, "pause");
  states.push(await state());
  await control(target, id, "resume");
  states.push(await state());
  await control(target, id, "cancel");
  states.push(await state());
  await target.close();
  server = null;
  return states;
}

test("a magnet goes to qBittorrent in the show folder, and pause, resume and remove reach qBittorrent 4 and 5", async () => {
  expect(await torrentRoundTrip(5)).toEqual(["downloading", "paused", "downloading", "gone"]);
  expect(await torrentRoundTrip(4)).toEqual(["downloading", "paused", "downloading", "gone"]);
}, 60_000);

test("direct downloads stay listed while qBittorrent is unreachable", async () => {
  const { target, site } = await start();
  site.serve("/held.mkv", { bytes: episodeBytes(8, 400_000), throttle: { chunk: 8000, delayMs: 50 } });
  await add(target, SHOW, [fileItem(site, "/held.mkv", `${SHOW} - 01.mkv`)]);
  target.qbittorrent.setReachable(false);

  const { downloads, torrentError } = await list(target);
  expect(torrentError).toBe("Could not reach qBittorrent");
  expect(downloads.map((download) => download.name)).toEqual([`${SHOW} - 01.mkv`]);
}, 60_000);
