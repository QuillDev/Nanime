import { afterEach, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fileOperation, listedItems, operationStatus, reference, startLibraryTestServer, viewerCookie, type LibraryTestServer,
} from "./libraryFilesTestServer.ts";

const EPISODE_ONE = "Example Show/Season 1/Example Show - 01.mkv";
let server: LibraryTestServer | null = null;
let outside: string | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
  if (outside !== null) {
    await rm(outside, { recursive: true, force: true });
    outside = null;
  }
});

async function start(): Promise<LibraryTestServer> {
  server = await startLibraryTestServer();
  return server;
}

async function describeEntry(entry: Dirent, abs: string): Promise<string> {
  if (entry.isFile()) {
    return await readFile(abs, "utf8");
  }
  return entry.isSymbolicLink() ? "symlink" : "dir";
}

async function statusOf(target: LibraryTestServer, path: string, init: RequestInit & { readonly cookie?: string | null }): Promise<number> {
  const response = await target.request(path, init);
  return response.status;
}

/** Every path and file body under the library, to prove a rejection changed nothing. */
async function tree(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const described = await Promise.all(entries.map(async (entry) => {
    const abs = join(entry.parentPath, entry.name);
    return `${abs.slice(root.length)}=${await describeEntry(entry, abs)}`;
  }));
  return described.toSorted();
}

function journalStatuses(target: LibraryTestServer): readonly string[] {
  const database = target.database();
  try {
    return database.query<{ readonly status: string }, []>("SELECT status FROM library_file_operations ORDER BY created_at").all().map((row) => row.status);
  } finally {
    database.close();
  }
}

test("only signed-in, same-origin admins can read or change library files", async () => {
  const target = await start();
  const before = await tree(target.media);
  const viewer = await viewerCookie(target);
  const episode = await reference(target, EPISODE_ONE);
  const move = JSON.stringify({ items: [episode], target: null });
  expect(await statusOf(target, "/api/library/files", { cookie: null })).toBe(401);
  expect(await statusOf(target, "/api/library/files", { cookie: viewer })).toBe(403);
  expect(await statusOf(target, "/api/library/files/move", { method: "POST", body: move, cookie: viewer })).toBe(403);
  expect(await statusOf(target, "/api/library/files/move", { method: "POST", body: move, cookie: null })).toBe(401);
  expect(await statusOf(target, "/api/library/files/move", { method: "POST", body: move, headers: { origin: "http://evil.invalid" } })).toBe(403);
  expect(await statusOf(target, "/api/library/files/trash", { method: "POST", body: JSON.stringify({ items: [episode] }), cookie: viewer })).toBe(403);
  expect(await tree(target.media)).toEqual(before);
});

test("rejects traversal, absolute, internal, stale, self, descendant, and same-folder requests without side effects", async () => {
  const target = await start();
  const before = await tree(target.media);
  const episode = await reference(target, EPISODE_ONE);
  const show = await reference(target, "Example Show");
  const season = await reference(target, "Example Show/Season 1");
  const cases: readonly [string, unknown, number, string][] = [
    ["move", { items: [{ path: "../outside.mkv", id: episode.id }], target: null }, 400, "outside the library"],
    ["move", { items: [{ path: "/etc/passwd", id: episode.id }], target: null }, 400, "outside the library"],
    ["move", { items: [{ path: "Example Show/../Other Show", id: show.id }], target: null }, 400, "outside the library"],
    ["move", { items: [episode], target: { path: ".nanime-trash", id: show.id } }, 400, "internal folders"],
    ["move", { items: [{ path: EPISODE_ONE, id: show.id }], target: null }, 409, "changed since the list was loaded"],
    ["move", { items: [show], target: show }, 400, "into itself"],
    ["move", { items: [show], target: season }, 400, "into itself"],
    ["move", { items: [episode], target: season }, 400, "already in that folder"],
    ["rename", { item: episode, name: "../escape.mkv" }, 400, "can't contain"],
    ["rename", { item: season, name: ".nanime-trash" }, 400, "reserved"],
    ["rename", { item: season, name: "Season 2" }, 409, "already exists"],
    ["rename", { item: season, name: "season 2" }, 409, "already exists"],
    ["folders", { parent: show, name: "MISC" }, 409, "already exists"],
    ["folders", { parent: null, name: "Trailing " }, 400, "start or end with a space"],
    ["folders", { parent: { path: "Missing", id: show.id }, name: "x" }, 404, "no longer exists"],
    ["operations/00000000-0000-4000-8000-000000000000/revert", undefined, 404, "can't be found"],
  ];
  for (const [action, body, status, message] of cases) {
    const result = await fileOperation(target, action, body);
    expect({ action, status: result.status }).toEqual({ action, status });
    expect(result.text).toContain(message);
  }
  expect(await tree(target.media)).toEqual(before);
});

test("never overwrites on collision and never follows symbolic links", async () => {
  const target = await start();
  outside = await mkdtemp(join(tmpdir(), "nanime-library-outside-"));
  await writeFile(join(outside, "secret.txt"), "outside");
  await writeFile(join(target.media, "Other Show", "Notes.txt"), "other notes");
  await symlink(outside, join(target.media, "Example Show", "Misc", "Escape"));
  await symlink(join(outside, "secret.txt"), join(target.media, "Other Show", "Linked.txt"));
  const before = await tree(target.media);
  const notes = await reference(target, "Other Show/Notes.txt");
  const misc = await reference(target, "Example Show/Misc");
  const collision = await fileOperation(target, "move", { items: [notes], target: misc });
  expect(collision.status).toBe(409);
  expect(collision.text).toContain("“Notes.txt” already exists there");
  const folderWithLink = await fileOperation(target, "move", { items: [misc], target: null });
  expect(folderWithLink.status).toBe(400);
  expect(folderWithLink.text).toContain("symbolic link");
  const link = await fileOperation(target, "trash", { items: [await reference(target, "Other Show/Linked.txt")] });
  expect(link.status).toBe(400);
  const through = await fileOperation(target, "folders", { parent: { path: "Example Show/Misc/Escape", id: misc.id }, name: "x" });
  expect(through.status).toBe(400);
  const listed = await listedItems(target);
  expect(listed.find((item) => item.path === "Other Show/Linked.txt")?.lock?.source).toBe("symlink");
  expect(await tree(target.media)).toEqual(before);
  expect(await readdir(outside)).toEqual(["secret.txt"]);
});

test("torrent-owned payloads and their ancestors are locked by the server", async () => {
  const target = await start();
  target.qbittorrent.setTorrents([
    { hash: "a".repeat(40), name: "Seeding Show", content: join(target.media, "Seeding Show"), progress: 1 },
    { hash: "b".repeat(40), name: "Partial Show", content: join(target.media, "Incoming", "Partial Show"), progress: 0.5 },
  ]);
  const before = await tree(target.media);
  const seeding = await fileOperation(target, "rename", { item: await reference(target, "Seeding Show/Seeding Show - 01.mkv"), name: "Other.mkv" });
  expect(seeding.status).toBe(423);
  expect(seeding.text).toContain("Moving it would break seeding");
  const ancestor = await fileOperation(target, "move", { items: [await reference(target, "Incoming")], target: await reference(target, "Other Show") });
  expect(ancestor.status).toBe(423);
  expect(ancestor.text).toContain("Downloading in qBittorrent (50%)");
  const trash = await fileOperation(target, "trash", { items: [await reference(target, "Seeding Show")] });
  expect(trash.status).toBe(423);
  expect(await tree(target.media)).toEqual(before);
  expect(await operationStatus(target, "move", { items: [await reference(target, EPISODE_ONE)], target: await reference(target, "Incoming") })).toBe(200);
});

test("fails closed when configured qBittorrent ownership can't be read", async () => {
  const target = await start();
  const episode = await reference(target, EPISODE_ONE);
  target.qbittorrent.setReachable(false);
  const before = await tree(target.media);
  const items = await listedItems(target);
  expect(items.every((item) => item.lock?.source === "torrent-unavailable" || item.lock?.source === "symlink")).toBe(true);
  const move = await fileOperation(target, "move", { items: [episode], target: null });
  expect(move.status).toBe(423);
  expect(move.text).toContain("qBittorrent can't be reached");
  expect(await tree(target.media)).toEqual(before);
  expect(await operationStatus(target, "folders", { parent: null, name: "Still Allowed" })).toBe(200);
  target.qbittorrent.setReachable(true);
  target.qbittorrent.setTorrents([{ hash: "c".repeat(40), name: "Unplaced", content: "", progress: 0.1 }]);
  const malformed = await fileOperation(target, "move", { items: [episode], target: null });
  expect(malformed.status).toBe(423);
  target.qbittorrent.setTorrents([]);
  expect(await operationStatus(target, "move", { items: [episode], target: null })).toBe(200);
});

test("active transcodes lock their source and the folders above it", async () => {
  const target = await start();
  const database = target.database();
  try {
    database.query("INSERT INTO transcode_jobs (id, source_rel, preset, output_rel, status, input_size, created_at, updated_at) VALUES ('job-active', ?, 'space-saver', '.nanime-transcodes/a.mkv', 'processing', 1, 1, 1)").run(EPISODE_ONE);
  } finally {
    database.close();
  }
  const result = await fileOperation(target, "rename", { item: await reference(target, "Example Show"), name: "Renamed" });
  expect(result.status).toBe(423);
  expect(result.text).toContain("A transcode is reading this video");
  expect(await lstat(join(target.media, "Example Show")).then(() => true)).toBe(true);
});

test("a filesystem failure part-way rolls every completed step back", async () => {
  const target = await start();
  const locked = join(target.media, "Other Show");
  const items = [await reference(target, EPISODE_ONE), await reference(target, "Other Show/Episode 1.mp4")];
  const before = await tree(target.media);
  await chmod(locked, 0o555);
  try {
    const result = await fileOperation(target, "move", { items, target: await reference(target, "Example Show/Misc") });
    expect(result.status).toBe(409);
    expect(result.text).toContain("rolled back; nothing was changed");
  } finally {
    await chmod(locked, 0o755);
  }
  expect(await tree(target.media)).toEqual(before);
  expect(journalStatuses(target)).toEqual(["rolled-back"]);
  const database = target.database();
  try {
    expect(database.query("SELECT COUNT(*) AS count FROM media_path_history").get()).toEqual({ count: 0 });
    expect(database.query("SELECT COUNT(*) AS count FROM library_activity_log").get()).toEqual({ count: 0 });
  } finally {
    database.close();
  }
});

test("a database conflict after the filesystem moved rolls the move back", async () => {
  const target = await start();
  const database = target.database();
  try {
    database.query("INSERT INTO playback_progress (user_id, rel, position, duration, completed, updated_at, dismissed_at) VALUES (1, ?, 5, 10, 0, 1, NULL)").run("Example Show/Misc/Example Show - 01.mkv");
  } finally {
    database.close();
  }
  const before = await tree(target.media);
  const result = await fileOperation(target, "move", { items: [await reference(target, EPISODE_ONE)], target: await reference(target, "Example Show/Misc") });
  expect(result.status).toBe(409);
  expect(result.text).toContain("still has saved watch progress recorded for a missing item");
  expect(await tree(target.media)).toEqual(before);
  expect(journalStatuses(target)).toEqual(["rolled-back"]);
});

test("concurrent moves of one file apply exactly once", async () => {
  const target = await start();
  const episode = await reference(target, EPISODE_ONE);
  const [misc, other] = [await reference(target, "Example Show/Misc"), await reference(target, "Other Show")];
  const results = await Promise.all([
    fileOperation(target, "move", { items: [episode], target: misc }),
    fileOperation(target, "move", { items: [episode], target: other }),
  ]);
  expect(results.map((result) => result.status).toSorted()).toEqual([200, 404]);
  const after = await listedItems(target);
  expect(after.filter((item) => item.id === episode.id)).toHaveLength(1);
  await mkdir(join(target.media, "Example Show", "Season 9"));
  const rescanned = await listedItems(target);
  expect(rescanned.some((item) => item.path === "Example Show/Season 9")).toBe(true);
});
