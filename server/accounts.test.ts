import { afterEach, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getJson, startLibraryTestServer, statusOf, VIEWER_PASSWORD, viewerCookie, type LibraryTestServer,
} from "./libraryFilesTestServer.ts";

const EPISODE = "Example Show/Season 1/Example Show - 01.mkv";
let server: LibraryTestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

interface Me { readonly username: string; readonly isAdmin: boolean }

function login(target: LibraryTestServer, password: string): Promise<Response> {
  return target.request("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "viewer", password }), cookie: null });
}

function sessionCookie(response: Response): string {
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

test("a provisioned user signs in with their password, and signing out ends that session", async () => {
  server = await startLibraryTestServer();
  const target = server;
  await viewerCookie(target);

  const rejected = await login(target, "not-the-password");
  expect(rejected.status).toBe(401);
  expect(sessionCookie(rejected)).toBe("");

  const signedIn = await login(target, VIEWER_PASSWORD);
  expect(signedIn.status).toBe(200);
  const cookie = sessionCookie(signedIn);
  expect(await getJson<Me>(target, "/api/auth/me", cookie)).toMatchObject({ username: "viewer", isAdmin: false });
  expect(await statusOf(target.request("/api/progress", { cookie }))).toBe(200);

  expect(await statusOf(target.request("/api/auth/logout", { method: "POST", cookie }))).toBe(204);
  expect(await getJson<Me | null>(target, "/api/auth/me", cookie)).toBeNull();
  expect(await statusOf(target.request("/api/progress", { cookie }))).toBe(401);
  expect(await statusOf(target.request("/api/list", { cookie: null }))).toBe(401);
});

interface AdminAction {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
}

/** Every admin-only library operation, each with a body the route would otherwise accept. */
const ADMIN_ACTIONS: readonly AdminAction[] = [
  { method: "GET", path: "/api/users" },
  { method: "POST", path: "/api/users", body: { username: "intruder", isAdmin: true } },
  { method: "DELETE", path: "/api/users/1" },
  { method: "POST", path: "/api/media/delete", body: { paths: [EPISODE] } },
  { method: "POST", path: "/api/media/prune-tracks", body: { operations: [{ path: EPISODE, audioIndices: [0], subtitleIndices: [] }] } },
  { method: "POST", path: "/api/media/uploads", body: { fileName: "Example Show - 04.mkv", folder: "Example Show/Season 2", size: 4 } },
  { method: "POST", path: "/api/media/scans", body: { paths: [EPISODE] } },
  { method: "POST", path: "/api/transcodes", body: { path: EPISODE, preset: "compatibility" } },
  { method: "POST", path: "/api/transcodes/bulk", body: { paths: [EPISODE], preset: "compatibility" } },
  { method: "POST", path: `/api/torrents/${"a".repeat(40)}/cancel`, body: { deleteFiles: true } },
  { method: "POST", path: "/api/anilist/link", body: { key: "show:Example Show", id: 5, manualTitle: "Hijacked" } },
  { method: "POST", path: "/api/jikan/link", body: { key: "show:Example Show", id: 5 } },
  { method: "PUT", path: "/api/metadata/anilist-id", body: { key: "show:Example Show", anilistId: 5 } },
  { method: "POST", path: "/api/library/refresh" },
  { method: "POST", path: "/api/library/files/folders", body: { parent: null, name: "Intruder" } },
];

/** Every entry under the media root, with each file's contents. */
async function libraryTree(target: LibraryTestServer): Promise<Readonly<Record<string, string>>> {
  const entries = await readdir(target.media, { recursive: true, withFileTypes: true });
  const tree = await Promise.all(entries.map(async (entry) => {
    const path = join(entry.parentPath, entry.name);
    return [path, entry.isFile() ? await readFile(path, "utf8") : "(folder)"] as const;
  }));
  return Object.fromEntries(tree);
}

/** What an admin can see of the library, users and jobs. */
interface AdminView {
  readonly users: unknown;
  readonly transcodes: unknown;
  readonly activity: unknown;
  readonly metadata: unknown;
  readonly files: Readonly<Record<string, string>>;
}

async function adminView(target: LibraryTestServer): Promise<AdminView> {
  return {
    users: await getJson(target, "/api/users"),
    transcodes: await getJson(target, "/api/transcodes"),
    activity: await getJson(target, "/api/library/activity"),
    metadata: await getJson(target, "/api/metadata"),
    files: await libraryTree(target),
  };
}

test("a viewer is refused every admin library operation and nothing changes", async () => {
  server = await startLibraryTestServer();
  const target = server;
  const viewer = await viewerCookie(target);
  const before = await adminView(target);

  const statuses = await Promise.all(ADMIN_ACTIONS.map(async ({ method, path, body }) => {
    const init = body === undefined ? { method, cookie: viewer } : { method, cookie: viewer, body: JSON.stringify(body) };
    const response = await target.request(path, init);
    return `${method} ${path} -> ${String(response.status)}`;
  }));
  const torrent = new FormData();
  torrent.set("magnet", `magnet:?xt=urn:btih:${"b".repeat(40)}`);
  torrent.set("showFolder", "Example Show");
  const added = await target.request("/api/torrents", { method: "POST", body: torrent, cookie: viewer });

  expect(statuses).toEqual(ADMIN_ACTIONS.map(({ method, path }) => `${method} ${path} -> 403`));
  expect(added.status).toBe(403);
  expect(await adminView(target)).toEqual(before);
});
