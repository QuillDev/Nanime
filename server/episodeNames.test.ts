import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { startLibraryTestServer, type LibraryTestServer } from "./libraryFilesTestServer.ts";

const RELEASE = "[Group] Lantern Keepers (Season 02) [1080p]";
const EPISODE = `${RELEASE}/[Group] Lantern Keepers - S02E01.mkv`;
const SHOW_MATCH = { provider: "anilist", id: 41 } as const;
const SEASON_MATCH = { provider: "anilist", id: 42 } as const;
const ORGANIZED = "Lantern Keepers/002. Lantern Keepers Season 2";
let server: LibraryTestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

async function writeRelease(media: string): Promise<void> {
  const files = {
    [EPISODE]: "episode one",
    [`${RELEASE}/[Group] Lantern Keepers - S02E01.en.ass`]: "[Script Info]",
    [`${RELEASE}/[Group] Lantern Keepers - S02E02.mkv`]: "episode two",
    [`${RELEASE}/nanime.json`]: JSON.stringify({ version: 1, show: SHOW_MATCH, season: SEASON_MATCH }),
  };
  for (const [path, contents] of Object.entries(files)) {
    const abs = join(media, ...path.split("/"));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, contents);
  }
}

async function start(progress: number): Promise<LibraryTestServer> {
  server = await startLibraryTestServer(writeRelease);
  server.qbittorrent.setTorrents([{ hash: "c".repeat(40), name: RELEASE, content: join(server.media, RELEASE), progress }]);
  return server;
}

function organize(target: LibraryTestServer): Promise<Response> {
  return target.request("/api/library/files/episode-names", {
    method: "POST",
    body: JSON.stringify({
      folder: RELEASE,
      showFolder: "Lantern Keepers",
      seasonFolder: "002. Lantern Keepers Season 2",
      episodes: [
        { rel: EPISODE, name: "001. The Lamp Is Lit.mkv" },
        { rel: `${RELEASE}/[Group] Lantern Keepers - S02E02.mkv`, name: "002. Keepers' Oath.mkv" },
      ],
    }),
  });
}

interface MetadataFile {
  readonly show?: unknown;
  readonly season?: unknown;
}

async function metadataFile(target: LibraryTestServer, folder: string): Promise<MetadataFile> {
  const text = await readFile(join(target.media, ...folder.split("/"), "nanime.json"), "utf8");
  return JSON.parse(text) as MetadataFile;
}

async function listing(target: LibraryTestServer, folder: string): Promise<readonly string[]> {
  const names = await readdir(join(target.media, ...folder.split("/")));
  return names.toSorted();
}

test("organizing a seeding release folder stops seeding and carries progress, subtitles and matches along", async () => {
  const target = await start(1);
  const watched = await target.request("/api/progress/watched", { method: "POST", body: JSON.stringify({ rel: EPISODE, watched: true }) });
  expect(watched.status).toBe(200);

  const response = await organize(target);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ folder: ORGANIZED, stoppedSeeding: true });
  expect(await listing(target, ORGANIZED))
    .toEqual(["001. The Lamp Is Lit.en.ass", "001. The Lamp Is Lit.mkv", "002. Keepers' Oath.mkv", "nanime.json"]);
  expect(await readdir(target.media)).toEqual(["Lantern Keepers"]);
  expect(await metadataFile(target, "Lantern Keepers")).toMatchObject({ show: SHOW_MATCH });
  expect(await metadataFile(target, ORGANIZED)).toMatchObject({ season: SEASON_MATCH });
  const renamed = encodeURIComponent(`${ORGANIZED}/001. The Lamp Is Lit.mkv`);
  const progress = await target.request(`/api/progress/history?rel=${renamed}`);
  expect(await progress.json()).toContainEqual(expect.objectContaining({ action: "watched" }));
  const torrents = await fetch(`${target.qbittorrent.origin}/api/v2/torrents/info`);
  expect(await torrents.json()).toEqual([]);
}, 30_000);

test("a season still downloading is left untouched", async () => {
  const target = await start(0.5);

  const response = await organize(target);

  expect(response.status).toBe(423);
  expect(await listing(target, RELEASE)).toContain("[Group] Lantern Keepers - S02E01.mkv");
}, 30_000);
