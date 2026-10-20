import { afterEach, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { PlaybackProgress } from "../shared/types.ts";
import { getJson, startLibraryTestServer, statusOf, viewerCookie, type LibraryTestServer } from "./libraryFilesTestServer.ts";
import { makeClip } from "./testMedia.ts";

const EPISODE = "Example Show/Season 1/Example Show - 01.mkv";
let server: LibraryTestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

test("watch state, accounts and sessions survive a server restart", async () => {
  server = await startLibraryTestServer();
  const target = server;
  const viewer = await viewerCookie(target);
  expect(await statusOf(target.request("/api/progress/watched", { method: "POST", json: { rel: EPISODE, watched: true }, cookie: viewer }))).toBe(200);

  await target.restart();

  const me = await getJson<{ readonly username: string } | null>(target, "/api/auth/me", viewer);
  expect(me?.username).toBe("viewer");
  const progress = await getJson<readonly PlaybackProgress[]>(target, "/api/progress", viewer);
  expect(progress.map(({ rel, completed }) => ({ rel, completed }))).toEqual([{ rel: EPISODE, completed: true }]);
});

interface Artifact { readonly id: string; readonly status: string }

async function waitForStatus(target: LibraryTestServer, id: string, wanted: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const artifact = await getJson<Artifact>(target, `/api/offline-media/${id}`);
    if (artifact.status === wanted) {
      return;
    }
    expect(artifact.status).not.toBe("failed");
    await Bun.sleep(50);
  }
  throw new Error(`Offline copy never reached ${wanted}`);
}

test("an offline copy interrupted by a crash is prepared again after the restart", async () => {
  const slow = "Slow Show/Episode 01.mkv";
  server = await startLibraryTestServer(async (media) => {
    await mkdir(join(media, "Slow Show"));
    // Full-frame noise keeps the encoder busy long enough to crash it mid-way.
    await makeClip(join(media, slow), { seconds: 20, size: "640x360", filter: "noise=alls=60:allf=t", audio: ["jpn"] });
  });
  const target = server;
  const prepared = await target.request("/api/offline-media", { method: "POST", json: { path: slow } });
  expect(prepared.status).toBe(202);
  const { id } = await prepared.json() as Artifact;
  await waitForStatus(target, id, "preparing");

  await target.restart("crash");

  await waitForStatus(target, id, "ready");
  const media = await target.request(`/offline-media/${id}/media`);
  expect(media.status).toBe(200);
  const bytes = await media.arrayBuffer();
  expect(bytes.byteLength).toBeGreaterThan(0);
}, 120_000);
