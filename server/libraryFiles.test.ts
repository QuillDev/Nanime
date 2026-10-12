import { afterEach, expect, test } from "bun:test";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fileOperation, fixtureMapping, getJson, idAt, listedItems, operationStatus, reference, startLibraryTestServer, type LibraryTestServer,
} from "./libraryFilesTestServer.ts";

const EPISODE_ONE = "Example Show/Season 1/Example Show - 01.mkv";
const SIDECAR_ONE = "Example Show/Season 1/Example Show - 01.en.ass";
let server: LibraryTestServer | null = null;

interface ActivityEvent {
  readonly action: string;
  readonly subject: string;
}

async function isDirectory(abs: string): Promise<boolean> {
  const stats = await lstat(abs);
  return stats.isDirectory();
}

afterEach(async () => {
  await server?.close();
  server = null;
});

async function start(): Promise<LibraryTestServer> {
  server = await startLibraryTestServer();
  return server;
}

async function onDisk(target: LibraryTestServer, path: string): Promise<boolean> {
  return await lstat(join(target.media, ...path.split("/"))).catch(() => null) !== null;
}

async function markWatched(target: LibraryTestServer, rel: string): Promise<void> {
  const response = await target.request("/api/progress/watched", { method: "POST", body: JSON.stringify({ rel, watched: true }) });
  expect(response.status).toBe(200);
}

async function historyFor(target: LibraryTestServer, rel: string): Promise<readonly { readonly id: number; readonly rel: string; readonly action: string }[]> {
  const response = await target.request(`/api/progress/history?rel=${encodeURIComponent(rel)}`);
  expect(response.status).toBe(200);
  return await response.json() as { readonly id: number; readonly rel: string; readonly action: string }[];
}

function progressRels(target: LibraryTestServer): readonly string[] {
  const database = target.database();
  try {
    return database.query<{ readonly rel: string }, []>("SELECT rel FROM playback_progress ORDER BY rel").all().map((row) => row.rel);
  } finally {
    database.close();
  }
}

test("lists the fictitious library with stable ids, media kinds, and torrent locks", async () => {
  const target = await start();
  target.qbittorrent.setTorrents([
    { hash: "a".repeat(40), name: "Seeding Show", content: join(target.media, "Seeding Show"), progress: 1 },
    { hash: "b".repeat(40), name: "Partial Show", content: join(target.media, "Incoming", "Partial Show"), progress: 0.42 },
  ]);
  const items = await listedItems(target);
  const byPath = new Map(items.map((item) => [item.path, item]));
  expect(byPath.get(EPISODE_ONE)?.media).toBe("video");
  expect(byPath.get(SIDECAR_ONE)?.media).toBe("subtitle");
  expect(byPath.get("Example Show/Misc")?.kind).toBe("folder");
  expect(byPath.get("Seeding Show/Seeding Show - 01.mkv")?.lock?.reason).toContain("break seeding");
  expect(byPath.get("Incoming/Partial Show/Partial Show - 01.mkv")?.lock).toMatchObject({ source: "torrent", tone: "busy" });
  expect(byPath.get("Incoming/Partial Show/Partial Show - 01.mkv")?.lock?.reason).toContain("42%");
  expect(byPath.get("Incoming")?.lock).toBeNull();
  expect(items.some((item) => item.path.includes(".nanime-"))).toBe(false);
  expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
});

test("creates folders at the root, in a show, and in a season, and logs each", async () => {
  const target = await start();
  const show = await reference(target, "Example Show");
  const season = await reference(target, "Example Show/Season 1");
  expect(await operationStatus(target, "folders", { parent: null, name: "New Show" })).toBe(200);
  expect(await operationStatus(target, "folders", { parent: show, name: "Season 3" })).toBe(200);
  expect(await operationStatus(target, "folders", { parent: season, name: "Extras" })).toBe(200);
  expect(await isDirectory(join(target.media, "New Show"))).toBe(true);
  expect(await isDirectory(join(target.media, "Example Show", "Season 3"))).toBe(true);
  expect(await isDirectory(join(target.media, "Example Show", "Season 1", "Extras"))).toBe(true);
  const activity = await getJson<readonly ActivityEvent[]>(target, "/api/library/activity");
  expect(activity.filter((event) => event.action === "folder-created").map((event) => event.subject).toSorted())
    .toEqual(["Example Show/Season 1/Extras", "Example Show/Season 3", "New Show"]);
});

test("moves a file Season 1 → Misc → Season 2 keeping id, sidecar, progress, history, and library rows", async () => {
  const target = await start();
  await markWatched(target, EPISODE_ONE);
  const before = await reference(target, EPISODE_ONE);
  const auditBefore = await historyFor(target, EPISODE_ONE);
  expect(await operationStatus(target, "move", { items: [before], target: await reference(target, "Example Show/Misc") })).toBe(200);
  const atMisc = await reference(target, "Example Show/Misc/Example Show - 01.mkv");
  expect(atMisc.id).toBe(before.id);
  expect(await operationStatus(target, "move", { items: [atMisc], target: await reference(target, "Example Show/Season 2") })).toBe(200);

  const finalPath = "Example Show/Season 2/Example Show - 01.mkv";
  expect(await onDisk(target, EPISODE_ONE)).toBe(false);
  expect(await onDisk(target, SIDECAR_ONE)).toBe(false);
  expect(await readFile(join(target.media, "Example Show", "Season 2", "Example Show - 01.mkv"), "utf8")).toBe("episode one");
  expect(await readFile(join(target.media, "Example Show", "Season 2", "Example Show - 01.en.ass"), "utf8")).toBe("[Script Info]");
  expect(await idAt(target, finalPath)).toBe(before.id);
  expect(progressRels(target)).toEqual([finalPath]);
  const progress = await getJson<readonly { readonly rel: string; readonly completed: boolean }[]>(target, "/api/progress");
  expect(progress).toEqual([expect.objectContaining({ rel: finalPath, completed: true })]);
  const history = await historyFor(target, finalPath);
  expect(history.map((event) => event.id)).toEqual(auditBefore.map((event) => event.id));
  expect(history[0]?.rel).toBe(EPISODE_ONE);
  const list = await getJson<readonly { readonly rel: string; readonly folder: string }[]>(target, "/api/list");
  expect(list.find((entry) => entry.rel === finalPath)?.folder).toBe("Example Show/Season 2");
  expect(list.some((entry) => entry.rel === EPISODE_ONE)).toBe(false);
});

test("renames a video together with its subtitle sidecar and keeps the extension", async () => {
  const target = await start();
  await markWatched(target, EPISODE_ONE);
  const episode = await reference(target, EPISODE_ONE);
  const changed = await fileOperation(target, "rename", { item: episode, name: "Pilot.mp4" });
  expect(changed.status).toBe(400);
  expect(JSON.parse(changed.text)).toEqual({ message: "Keep the .mkv extension." });
  expect(await operationStatus(target, "rename", { item: episode, name: "Pilot.mkv" })).toBe(200);
  expect(await onDisk(target, "Example Show/Season 1/Pilot.mkv")).toBe(true);
  expect(await onDisk(target, "Example Show/Season 1/Pilot.en.ass")).toBe(true);
  expect(await onDisk(target, SIDECAR_ONE)).toBe(false);
  expect(await idAt(target, "Example Show/Season 1/Pilot.mkv")).toBe(episode.id);
  expect(progressRels(target)).toEqual(["Example Show/Season 1/Pilot.mkv"]);
});

test("moving and renaming folders carries show and season mappings, scans, and transcode history", async () => {
  const target = await start();
  const database = target.database();
  try {
    const now = Date.now();
    database.query("INSERT INTO media_metadata (key, payload, updated_at) VALUES (?, ?, ?)").run("show:Example Show", fixtureMapping("Example Show", 11), now);
    database.query("INSERT INTO media_metadata (key, payload, updated_at) VALUES (?, ?, ?)").run("season:Example Show / Season 2", fixtureMapping("Example Show Season 2", 12), now);
    database.query("INSERT INTO media_scans (source_rel, status, file_size, modified_at, created_at, updated_at) VALUES (?, 'complete', 13, 1, ?, ?)").run("Example Show/Season 2/Example Show - 03.mkv", now, now);
    database.query("INSERT INTO media_scan_tracks (source_rel, stream_index, kind, size_bytes) VALUES (?, 1, 'audio', 5)").run("Example Show/Season 2/Example Show - 03.mkv");
    database.query("INSERT INTO transcode_jobs (id, source_rel, preset, output_rel, status, input_size, created_at, updated_at) VALUES ('job-1', ?, 'space-saver', '.nanime-transcodes/x.mkv', 'complete', 13, ?, ?)").run("Example Show/Season 2/Example Show - 03.mkv", now, now);
  } finally {
    database.close();
  }
  expect(await operationStatus(target, "move", { items: [await reference(target, "Example Show/Season 2")], target: await reference(target, "Other Show") })).toBe(200);
  expect(await operationStatus(target, "rename", { item: await reference(target, "Example Show"), name: "Example Show Renamed" })).toBe(200);
  const metadata = await getJson<Readonly<Record<string, { readonly id: number }>>>(target, "/api/metadata");
  expect(metadata["show:Example Show Renamed"]?.id).toBe(11);
  expect(metadata["season:Other Show / Season 2"]?.id).toBe(12);
  expect(metadata["show:Example Show"]).toBeUndefined();
  const check = target.database();
  try {
    const moved = "Other Show/Season 2/Example Show - 03.mkv";
    expect(check.query("SELECT source_rel FROM media_scans").all()).toEqual([{ source_rel: moved }]);
    expect(check.query("SELECT source_rel FROM media_scan_tracks").all()).toEqual([{ source_rel: moved }]);
    expect(check.query("SELECT source_rel FROM transcode_jobs").all()).toEqual([{ source_rel: moved }]);
    const activity = check.query<{ readonly next_state: string }, []>("SELECT next_state FROM library_activity_log WHERE action = 'files-moved'").all();
    expect(JSON.parse(activity[0]?.next_state ?? "{}")).toMatchObject({ mappings: [{ from: "season:Example Show / Season 2", to: "season:Other Show / Season 2" }] });
  } finally {
    check.close();
  }
});

test("trash keeps watch state recoverable and Undo restores the same entries", async () => {
  const target = await start();
  await markWatched(target, EPISODE_ONE);
  const season = await reference(target, "Example Show/Season 1");
  const trashed = await fileOperation(target, "trash", { items: [season] });
  expect(trashed.status).toBe(200);
  const { operationId, revertible } = JSON.parse(trashed.text) as { readonly operationId: string; readonly revertible: boolean };
  expect(revertible).toBe(true);
  expect(await onDisk(target, "Example Show/Season 1")).toBe(false);
  const listed = await listedItems(target);
  expect(listed.some((item) => item.path.startsWith("Example Show/Season 1"))).toBe(false);
  expect(progressRels(target)[0]).toStartWith(`.nanime-trash/${operationId}/`);
  const list = await getJson<readonly { readonly rel: string }[]>(target, "/api/list");
  expect(list.some((entry) => entry.rel.includes("Season 1"))).toBe(false);

  expect(await operationStatus(target, `operations/${operationId}/revert`)).toBe(200);
  const restoredPath = join(target.media, ...EPISODE_ONE.split("/"));
  expect(await readFile(restoredPath, "utf8")).toBe("episode one");
  expect(await onDisk(target, SIDECAR_ONE)).toBe(true);
  expect(await idAt(target, "Example Show/Season 1")).toBe(season.id);
  expect(progressRels(target)).toEqual([EPISODE_ONE]);
  const repeatedUndo = await fileOperation(target, `operations/${operationId}/revert`);
  expect(repeatedUndo.status).toBe(409);
  expect(JSON.parse(repeatedUndo.text)).toEqual({ message: "That change was already undone." });
  const actions = await getJson<readonly { readonly action: string }[]>(target, "/api/library/activity");
  expect(actions.map((event) => event.action).slice(0, 2)).toEqual(["files-reverted", "files-trashed"]);
});

test("Undo of a move refuses to overwrite something that took the original place", async () => {
  const target = await start();
  const moved = await fileOperation(target, "move", { items: [await reference(target, EPISODE_ONE)], target: null });
  const { operationId } = JSON.parse(moved.text) as { readonly operationId: string };
  expect(await operationStatus(target, "folders", { parent: null, name: "Placeholder" })).toBe(200);
  await Bun.write(join(target.media, "Example Show", "Season 1", "Example Show - 01.mkv"), "a different file");
  const undo = await fileOperation(target, `operations/${operationId}/revert`);
  expect(undo.status).toBe(409);
  expect(undo.text).toContain("already exists there");
  expect(await readFile(join(target.media, "Example Show", "Season 1", "Example Show - 01.mkv"), "utf8")).toBe("a different file");
  expect(await readFile(join(target.media, "Example Show - 01.mkv"), "utf8")).toBe("episode one");
});

test("history restore writes to the media's current path after a move", async () => {
  const target = await start();
  await markWatched(target, EPISODE_ONE);
  const [watched] = await historyFor(target, EPISODE_ONE);
  expect(await operationStatus(target, "rename", { item: await reference(target, EPISODE_ONE), name: "Renamed.mkv" })).toBe(200);
  const restored = await target.request(`/api/progress/history/${String(watched?.id)}/restore`, { method: "POST" });
  expect(restored.status).toBe(200);
  expect(progressRels(target)).toEqual([]);
  const stale = await target.request("/api/progress/watched", { method: "POST", body: JSON.stringify({ rel: EPISODE_ONE, watched: true }) });
  expect(stale.status).toBe(200);
  expect(progressRels(target)).toEqual(["Example Show/Season 1/Renamed.mkv"]);
});
