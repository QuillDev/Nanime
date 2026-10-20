import { afterAll, beforeAll, expect, test } from "bun:test";
import type { PlaybackAuditEvent, PlaybackProgress } from "../shared/types.ts";
import { getJson, startLibraryTestServer, statusOf, type LibraryTestServer } from "./libraryFilesTestServer.ts";

const EPISODE = "Example Show/Season 1/Example Show - 01.mkv";
const LEGACY = "Other Show/Episode 1.mp4";
const ANILIST = { anilistMediaId: 42, episode: 1, totalEpisodes: 12 };
let server: LibraryTestServer | null = null;

beforeAll(async () => {
  server = await startLibraryTestServer();
});

afterAll(async () => {
  await server?.close();
});

function target(): LibraryTestServer {
  if (server === null) {
    throw new Error("Test server is not running");
  }
  return server;
}

function play(event: string, position: number, extra: { readonly sessionSeconds?: number } = {}): Promise<number> {
  const body = JSON.stringify({ rel: EPISODE, position, duration: 1200, completed: false, event, ...ANILIST, ...extra });
  return statusOf(target().request("/api/progress", { method: "PUT", body }));
}

function history(rel: string): Promise<readonly PlaybackAuditEvent[]> {
  return getJson<readonly PlaybackAuditEvent[]>(target(), `/api/progress/history?rel=${encodeURIComponent(rel)}`);
}

test("progress saved before history existed is imported once as the starting point", async () => {
  const database = target().database();
  try {
    database.run("INSERT INTO playback_progress (user_id, rel, position, duration, completed, updated_at, dismissed_at) VALUES (1, ?, 600, 1200, 1, 1, NULL)", [LEGACY]);
  } finally {
    database.close();
  }

  await target().restart();
  await target().restart();

  const imported = await history(LEGACY);
  expect(imported.map((event) => event.action)).toEqual(["snapshot-imported"]);
});

test("history records starts, stops and watched changes, not heartbeats, and restoring an event undoes it", async () => {
  expect(await play("started", 0)).toBe(200);
  expect(await play("heartbeat", 60)).toBe(200);
  expect(await play("stopped", 90, { sessionSeconds: 90 })).toBe(200);
  const watched = await target().request("/api/progress/watched", { method: "POST", json: { rel: EPISODE, watched: true, ...ANILIST } });
  expect(watched.status).toBe(200);

  const recorded = await history(EPISODE);
  expect(recorded.map((event) => event.action)).toEqual(["watched", "playback-stopped", "playback-started"]);
  expect(recorded[0]?.anilistMediaId).toBe(42);
  expect(recorded[1]?.sessionSeconds).toBe(90);

  const restore = await target().request(`/api/progress/history/${String(recorded[0]?.id)}/restore`, { method: "POST" });
  expect(restore.status).toBe(200);
  expect(await restore.json()).toMatchObject({ rel: EPISODE, position: 90, completed: false });
  const progress = await getJson<readonly PlaybackProgress[]>(target(), "/api/progress");
  expect(progress.find((entry) => entry.rel === EPISODE)).toMatchObject({ position: 90, completed: false });
  const after = await history(EPISODE);
  expect(after.map((event) => event.action)).toEqual(["restored", "watched", "playback-stopped", "playback-started"]);
  expect(after[0]?.revertsEventId).toBe(recorded[0]?.id);
});

test("recorded history cannot be edited or deleted, even directly in the database", async () => {
  const marked = "Example Show/Season 1/Example Show - 02.mkv";
  expect(await statusOf(target().request("/api/progress/watched", { method: "POST", json: { rel: marked, watched: true } }))).toBe(200);
  expect(await statusOf(target().request("/api/library/files/folders", { method: "POST", json: { parent: null, name: "New Show" } }))).toBe(200);
  const before = await history(marked);
  const activity = await getJson<readonly unknown[]>(target(), "/api/library/activity");
  expect(before).toHaveLength(1);
  expect(activity).toHaveLength(1);
  const database = target().database();
  try {
    expect(() => database.run("UPDATE playback_audit_log SET action = 'unwatched'")).toThrow();
    expect(() => database.run("DELETE FROM playback_audit_log")).toThrow();
    expect(() => database.run("DELETE FROM library_activity_log")).toThrow();
  } finally {
    database.close();
  }
  expect(await history(marked)).toEqual(before);
  expect(await getJson<readonly unknown[]>(target(), "/api/library/activity")).toEqual(activity);
});
