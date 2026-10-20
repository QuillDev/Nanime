import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { startLibraryTestServer, type FakeLogin, type LibraryTestServer } from "./libraryFilesTestServer.ts";

let server: LibraryTestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

/** Lists downloading torrents through Nanime against a qBittorrent that answers logins with `login`. */
async function listWith(login: FakeLogin): Promise<{ readonly error: string | null; readonly names: readonly string[] }> {
  server = await startLibraryTestServer(undefined, { qbittorrentLogin: login });
  server.qbittorrent.setTorrents([{ hash: "a".repeat(40), name: "Partial Show", content: join(server.media, "Incoming", "Partial Show"), progress: 0.5 }]);
  const response = await server.request("/api/downloads");
  const { downloads, torrentError } = await response.json() as { readonly downloads: readonly { readonly name: string }[]; readonly torrentError: string | null };
  await server.close();
  server = null;
  return { error: torrentError, names: downloads.map((download) => download.name) };
}

test("signs in to qBittorrent 4.x and 5.x, and reports a refused login instead of an empty list", async () => {
  expect(await listWith({ status: 200, body: "Ok." })).toEqual({ error: null, names: ["Partial Show"] });
  expect(await listWith({ status: 204, body: "" })).toEqual({ error: null, names: ["Partial Show"] });
  expect(await listWith({ status: 200, body: "Fails." })).toEqual({ error: "Could not reach qBittorrent", names: [] });
}, 30_000);
