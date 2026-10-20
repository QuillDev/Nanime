import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { startLibraryTestServer, type FakeLogin, type LibraryTestServer } from "./libraryFilesTestServer.ts";

let server: LibraryTestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

/** Lists downloading torrents through Nanime against a qBittorrent that answers logins with `login`. */
async function listWith(login: FakeLogin): Promise<{ readonly status: number; readonly names: readonly string[] }> {
  server = await startLibraryTestServer(undefined, { qbittorrentLogin: login });
  server.qbittorrent.setTorrents([{ hash: "a".repeat(40), name: "Partial Show", content: join(server.media, "Incoming", "Partial Show"), progress: 0.5 }]);
  const response = await server.request("/api/torrents");
  const names = response.ok ? (await response.json() as readonly { readonly name: string }[]).map((torrent) => torrent.name) : [];
  await server.close();
  server = null;
  return { status: response.status, names };
}

test("signs in to qBittorrent 4.x and 5.x, and reports a refused login instead of an empty list", async () => {
  expect(await listWith({ status: 200, body: "Ok." })).toEqual({ status: 200, names: ["Partial Show"] });
  expect(await listWith({ status: 204, body: "" })).toEqual({ status: 200, names: ["Partial Show"] });
  expect(await listWith({ status: 200, body: "Fails." })).toEqual({ status: 502, names: [] });
}, 30_000);
