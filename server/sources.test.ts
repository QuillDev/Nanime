import { afterEach, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { DownloadStatus } from "../shared/types.ts";
import { getJson, startLibraryTestServer, statusOf, viewerCookie, type LibraryTestServer } from "./libraryFilesTestServer.ts";
import { probeStreams } from "./testMedia.ts";
import { waitUntil } from "./testProcess.ts";
import { MAGNET_HASH, SHOW_TITLE, publishFakeRepository, type FakeRepository } from "./testSourcePlugins.ts";
import { startFakeSource, type FakeSource } from "./testSource.ts";

let server: LibraryTestServer | null = null;
let site: FakeSource | null = null;

afterEach(async () => {
  await server?.close();
  site?.stop();
  server = null;
  site = null;
});

interface Setup {
  readonly target: LibraryTestServer;
  readonly repo: FakeRepository;
}

/** A server allowed to reach the loopback fake site, with the fictional repository added. */
async function withRepository(): Promise<Setup> {
  server = await startLibraryTestServer(async () => {}, { env: { NANIME_SOURCE_ALLOW_PRIVATE_NETWORK: "1", NANIME_SOURCE_CALL_TIMEOUT_MS: "3000" } });
  site = await startFakeSource();
  const repo = await publishFakeRepository(site);
  const added = await server.request("/api/sources/repos", { method: "POST", json: { url: repo.indexUrl } });
  expect(await added.json()).toEqual({ sources: 3 });
  return { target: server, repo };
}

function post(target: LibraryTestServer, path: string, json: unknown): Promise<Response> {
  return target.request(path, { method: "POST", json });
}

async function install(target: LibraryTestServer, id: string): Promise<void> {
  const response = await post(target, "/api/sources/install", { id });
  expect(response.status).toBe(200);
}

interface Results {
  readonly results: readonly { readonly name: string; readonly link: string; readonly imageUrl: string | null }[];
  readonly hasNextPage: boolean;
}

function search(target: LibraryTestServer, id: string, query: string): Promise<Response> {
  return target.request(`/api/sources/search?${new URLSearchParams({ id, q: query })}`);
}

async function searchNames(target: LibraryTestServer, id: string, query: string): Promise<readonly string[]> {
  const response = await search(target, id, query);
  const { results } = await response.json() as Results;
  return results.map((entry) => entry.name);
}

async function downloads(target: LibraryTestServer): Promise<readonly DownloadStatus[]> {
  const { downloads: listed } = await getJson<{ readonly downloads: readonly DownloadStatus[] }>(target, "/api/downloads");
  return listed;
}

function waitForNoDownloads(target: LibraryTestServer): Promise<true> {
  return waitUntil("the downloads to finish", async () => {
    const listed = await downloads(target);
    expect(listed.filter((download) => download.state === "failed")).toEqual([]);
    return listed.length === 0 ? true : undefined;
  }, 60_000);
}

test("a repository's anime JS sources install, search, list episodes and download a season with subtitles", async () => {
  const { target, repo } = await withRepository();
  const lantern = repo.ids["Lantern Stream"] ?? "";
  const listing = await getJson<{ readonly repos: readonly { readonly sources: readonly { readonly name: string; readonly installedVersion: string | null }[] }[] }>(target, "/api/sources");
  expect(listing.repos[0]?.sources.map((entry) => [entry.name, entry.installedVersion])).toEqual([["Lantern Stream", null], ["Probe", null], ["Broken", null]]);

  await install(target, lantern);
  const found = await search(target, lantern, "lantern");
  expect(await found.json()).toEqual({
    results: [
      { name: SHOW_TITLE, link: "/show/lantern", imageUrl: "/covers/lantern.jpg" },
      { name: "Moth Harbor", link: "/show/other", imageUrl: "/covers/moth.jpg" },
    ],
    hasNextPage: true,
  });
  const detail = await getJson<{ readonly name: string; readonly episodes: readonly { readonly url: string; readonly number: number }[] }>(
    target, `/api/sources/detail?${new URLSearchParams({ id: lantern, url: "/show/lantern" })}`,
  );
  expect(detail).toMatchObject({ name: SHOW_TITLE, description: "Ferries cross a lantern-lit bay.", genres: ["Slice of Life", "Drama"] });
  expect(detail.episodes.map((episode) => [episode.number, episode.url])).toEqual([[1, "/watch/1"], [2, "/watch/2"]]);
  const untitled = await getJson<{ readonly episodes: readonly { readonly name: string; readonly number: number }[] }>(
    target, `/api/sources/detail?${new URLSearchParams({ id: lantern, url: "/show/other" })}`,
  );
  expect(untitled.episodes.map((episode) => [episode.number, episode.name])).toEqual([[1, "Harbor Lights"], [2, "Paper Moths"], [3, "The Tide Comes Back"]]);

  const queued = await post(target, "/api/sources/download", { id: lantern, showFolder: SHOW_TITLE, episodes: detail.episodes });
  expect(await queued.json()).toEqual({ added: 2 });
  await waitForNoDownloads(target);

  const folder = join(target.media, SHOW_TITLE);
  const files = await readdir(folder);
  expect(files.toSorted()).toEqual([`${SHOW_TITLE} - 01.en.srt`, `${SHOW_TITLE} - 01.mp4`, `${SHOW_TITLE} - 02.mp4`]);
  const streams = await probeStreams(join(folder, `${SHOW_TITLE} - 02.mp4`));
  expect(streams.map((stream) => stream.codec_type)).toEqual(["video", "audio"]);
  expect(await readFile(join(folder, `${SHOW_TITLE} - 01.en.srt`), "utf8")).toContain("The last ferry leaves at dusk.");
}, 90_000);

test("a source's settings start at the plugin's defaults and change what it does", async () => {
  const { target, repo } = await withRepository();
  const lantern = repo.ids["Lantern Stream"] ?? "";
  await install(target, lantern);
  const settings = await getJson<readonly unknown[]>(target, `/api/sources/settings?${new URLSearchParams({ id: lantern })}`);
  expect(settings).toEqual([{
    key: "audio", kind: "list", title: "Audio", summary: "",
    options: [{ label: "Subtitled", value: "sub" }, { label: "Dubbed", value: "dub" }], value: "sub",
  }]);

  expect(await statusOf(post(target, "/api/sources/settings", { id: lantern, key: "audio", value: "latin" }))).toBe(400);
  expect(await statusOf(post(target, "/api/sources/settings", { id: lantern, key: "audio", value: "dub" }))).toBe(200);
  expect(await searchNames(target, lantern, "lantern")).toEqual([`${SHOW_TITLE} (Dub)`, "Moth Harbor"]);
}, 60_000);

test("an episode the source serves as a magnet goes to qBittorrent in the show folder", async () => {
  const { target, repo } = await withRepository();
  const lantern = repo.ids["Lantern Stream"] ?? "";
  await install(target, lantern);
  await post(target, "/api/sources/download", { id: lantern, showFolder: SHOW_TITLE, episodes: [{ url: "magnet-batch", number: 1 }] });

  const torrent = await waitUntil("qBittorrent to get the magnet", () => Promise.resolve(target.qbittorrent.torrents()[0]));
  expect(torrent).toMatchObject({ hash: MAGNET_HASH, content: join(target.media, SHOW_TITLE, "Lantern Ferry Club Batch") });
  const ids = await waitUntil("the episode to become the torrent", async () => {
    const listed = await downloads(target);
    return listed.length === 1 ? listed.map((download) => download.id) : undefined;
  });
  expect(ids).toEqual([`torrent:${MAGNET_HASH}`]);
}, 60_000);

test("plugins run sandboxed: no host APIs, no local files, and a call that never ends is stopped", async () => {
  const { target, repo } = await withRepository();
  const probe = repo.ids["Probe"] ?? "";
  await install(target, probe);

  expect(await searchNames(target, probe, "globals")).toEqual([
    "require:undefined", "process:undefined", "Bun:undefined", "fetch:undefined", "XMLHttpRequest:undefined", "Deno:undefined",
  ]);
  const local = await search(target, probe, "file");
  expect(local.status).toBe(502);
  expect(await local.text()).toContain("Sources can only use http and https links");
  const forever = await search(target, probe, "forever");
  expect(forever.status).toBe(502);
  expect(await searchNames(target, probe, "globals")).toHaveLength(6);
}, 60_000);

test("a source that doesn't load isn't installed, and removing one fails its queued episodes", async () => {
  const { target, repo } = await withRepository();
  const broken = await post(target, "/api/sources/install", { id: repo.ids["Broken"] });
  expect(broken.status).toBe(502);
  expect(await broken.text()).toContain("Broken failed while loading");

  const lantern = repo.ids["Lantern Stream"] ?? "";
  await install(target, lantern);
  await post(target, "/api/sources/download", { id: lantern, showFolder: SHOW_TITLE, episodes: [{ url: "/watch/1", number: 1 }] });
  const [episode] = await downloads(target);
  await target.request(`/api/downloads/${episode?.id ?? ""}/pause`, { method: "POST" });
  await post(target, "/api/sources/uninstall", { id: lantern });
  const installed = await getJson<{ readonly sources: readonly unknown[] }>(target, "/api/sources");
  expect(installed.sources).toEqual([]);

  await target.request(`/api/downloads/${episode?.id ?? ""}/resume`, { method: "POST" });
  const failed = await waitUntil("the episode to fail", async () => {
    const listed = await downloads(target);
    return listed.find((download) => download.state === "failed");
  });
  expect(failed.error).toBe("Its source was removed");
}, 60_000);

test("repositories on private addresses are refused, and viewers can't use sources", async () => {
  server = await startLibraryTestServer(async () => {});
  const refused = await post(server, "/api/sources/repos", { url: "http://127.0.0.1:9/index.json" });
  expect(refused.status).toBe(400);
  expect(await refused.text()).toBe("Sources can't reach 127.0.0.1");
  const viewer = await viewerCookie(server);
  expect(await statusOf(server.request("/api/sources", { cookie: viewer }))).toBe(403);
}, 60_000);
