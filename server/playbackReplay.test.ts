import { afterEach, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MediaEntry, PlaybackAuditEvent, PlaybackProgress } from "../shared/types.ts";
import { getJson, operationStatus, reference, startLibraryTestServer, viewerCookie, type LibraryTestServer } from "./libraryFilesTestServer.ts";

let server: LibraryTestServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

async function start(): Promise<LibraryTestServer> {
  server = await startLibraryTestServer(async (media) => {
    await writeFile(join(media, "old.mkv"), "occupant A");
    await writeFile(join(media, "replacement.mkv"), "occupant B");
  });
  return server;
}

async function rename(target: LibraryTestServer, from: string, to: string): Promise<void> {
  expect(await operationStatus(target, "rename", { item: await reference(target, from), name: to })).toBe(200);
}

interface WatchedRequest { readonly rel: string; readonly watched: boolean; readonly mediaIdentity?: string }
interface ProgressRequest { readonly rel: string; readonly mediaIdentity?: string }

function watched(target: LibraryTestServer, body: WatchedRequest, cookie = target.adminCookie): Promise<Response> {
  return target.request("/api/progress/watched", { method: "POST", body: JSON.stringify(body), cookie });
}

function progress(target: LibraryTestServer, body: ProgressRequest, cookie = target.adminCookie): Promise<Response> {
  return target.request("/api/progress", { method: "PUT", body: JSON.stringify({ position: 42, duration: 100, completed: false, ...body }), cookie });
}

interface StoredProgress {
  readonly user_id: number;
  readonly rel: string;
  readonly position: number;
  readonly duration: number;
  readonly completed: number;
  readonly updated_at: number;
  readonly dismissed_at: number | null;
}
interface StoredAudit {
  readonly id: number;
  readonly user_id: number;
  readonly actor_user_id: number | null;
  readonly actor_username: string;
  readonly rel: string;
  readonly action: string;
  readonly origin: string;
  readonly previous_state: string | null;
  readonly next_state: string | null;
  readonly anilist_media_id: number | null;
  readonly episode: number | null;
  readonly total_episodes: number | null;
  readonly session_seconds: number | null;
  readonly reverts_event_id: number | null;
  readonly created_at: number;
}
interface StoredMove {
  readonly id: number;
  readonly operation_id: string;
  readonly old_rel: string;
  readonly new_rel: string;
  readonly created_at: number;
  readonly audit_watermark: number | null;
}

async function expectStatus(pending: Promise<Response>, status: number): Promise<void> {
  const response = await pending;
  expect(response.status).toBe(status);
}

function stored(target: LibraryTestServer): readonly StoredProgress[] {
  const database = target.database();
  try { return database.query<StoredProgress, []>("SELECT * FROM playback_progress ORDER BY user_id, rel").all(); }
  finally { database.close(); }
}

function immutableRows(target: LibraryTestServer) {
  const database = target.database();
  try {
    return { audit: database.query<StoredAudit, []>("SELECT * FROM playback_audit_log ORDER BY id").all(), paths: database.query<StoredMove, []>("SELECT * FROM media_path_history ORDER BY id").all() };
  } finally { database.close(); }
}

test("legacy queued progress and watched edits cannot mutate a reused path for either user", async () => {
  const target = await start();
  const viewer = await viewerCookie(target);
  await expectStatus(watched(target, { rel: "old.mkv", watched: true }), 200);
  await expectStatus(watched(target, { rel: "old.mkv", watched: true }, viewer), 200);
  await rename(target, "old.mkv", "new.mkv");
  await rename(target, "replacement.mkv", "old.mkv");
  const before = stored(target);
  const history = immutableRows(target);
  for (const cookie of [target.adminCookie, viewer]) {
    await expectStatus(progress(target, { rel: "old.mkv" }, cookie), 404);
    await expectStatus(watched(target, { rel: "old.mkv", watched: false }, cookie), 404);
  }
  expect(stored(target)).toEqual(before);
  expect(immutableRows(target)).toEqual(history);
  expect(await readFile(join(target.media, "old.mkv"), "utf8")).toBe("occupant B");
  expect(await readFile(join(target.media, "new.mkv"), "utf8")).toBe("occupant A");
});

test("legacy replay follows an unambiguous missing path but rejects multiple departed occupants", async () => {
  const target = await start();
  await rename(target, "old.mkv", "new.mkv");
  const response = await progress(target, { rel: "old.mkv" });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ rel: "new.mkv", position: 42 });
  await rename(target, "replacement.mkv", "old.mkv");
  await rename(target, "old.mkv", "elsewhere.mkv");
  const before = stored(target);
  await expectStatus(watched(target, { rel: "old.mkv", watched: true }), 404);
  expect(stored(target)).toEqual(before);
});

test("restoring immutable old-path events changes or clears only the moved media's current progress", async () => {
  const target = await start();
  await expectStatus(watched(target, { rel: "old.mkv", watched: true }), 200);
  await expectStatus(watched(target, { rel: "old.mkv", watched: false }), 200);
  const history = await getJson<readonly PlaybackAuditEvent[]>(target, "/api/progress/history");
  const watchedEvent = history.find((event) => event.action === "watched")!;
  const unwatchedEvent = history.find((event) => event.action === "unwatched")!;
  await rename(target, "old.mkv", "new.mkv");
  await rename(target, "replacement.mkv", "old.mkv");
  const previous = immutableRows(target);
  const restore = await target.request(`/api/progress/history/${String(unwatchedEvent.id)}/restore`, { method: "POST" });
  expect(restore.status).toBe(200);
  expect(await restore.json()).toMatchObject({ rel: "new.mkv", completed: true });
  const clear = await target.request(`/api/progress/history/${String(watchedEvent.id)}/restore`, { method: "POST" });
  expect(clear.status).toBe(200);
  expect(await clear.json()).toBeNull();
  expect(await getJson<readonly PlaybackProgress[]>(target, "/api/progress")).toEqual([]);
  const database = target.database();
  try {
    const originals = database.query<StoredAudit, []>("SELECT * FROM playback_audit_log WHERE action <> 'restored' ORDER BY id").all();
    expect({ audit: originals, paths: database.query<StoredMove, []>("SELECT * FROM media_path_history ORDER BY id").all() }).toEqual(previous);
    expect(database.query("SELECT rel, reverts_event_id FROM playback_audit_log WHERE action = 'restored' ORDER BY id").all()).toEqual([
      { rel: "new.mkv", reverts_event_id: unwatchedEvent.id }, { rel: "new.mkv", reverts_event_id: watchedEvent.id },
    ]);
  } finally { database.close(); }
});

// Wire-level typing here deliberately includes the additive identity field so
// this regression can run before production contracts gain it.
interface IdentifiedEntry extends MediaEntry { readonly mediaIdentity?: string }

test("identified queued edits reach A while explicit replacement writes reach B after repeated reuse", async () => {
  const target = await start();
  const viewer = await viewerCookie(target);
  const initial = await getJson<readonly IdentifiedEntry[]>(target, "/api/list");
  const a = initial.find((entry) => entry.rel === "old.mkv")!;
  const b = initial.find((entry) => entry.rel === "replacement.mkv")!;
  expect(a.mediaIdentity).toBeString();
  if (a.mediaIdentity === undefined || b.mediaIdentity === undefined) {
    throw new Error("Library response omitted media identity");
  }
  expect(b.mediaIdentity).not.toBe(a.mediaIdentity);
  await rename(target, "old.mkv", "new.mkv");
  await rename(target, "replacement.mkv", "old.mkv");
  for (const cookie of [target.adminCookie, viewer]) {
    const queued = await progress(target, { rel: a.rel, mediaIdentity: a.mediaIdentity }, cookie);
    expect(queued.status).toBe(200);
    expect(await queued.json()).toMatchObject({ rel: "new.mkv", position: 42 });
    const current = await watched(target, { rel: "old.mkv", mediaIdentity: b.mediaIdentity, watched: true }, cookie);
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({ rel: "old.mkv", completed: true });
  }
  await rename(target, "old.mkv", "elsewhere.mkv");
  await writeFile(join(target.media, "old.mkv"), "occupant C");
  const queued = await watched(target, { rel: "old.mkv", mediaIdentity: a.mediaIdentity, watched: true });
  expect(queued.status).toBe(200);
  expect(await queued.json()).toMatchObject({ rel: "new.mkv", completed: true });
  const before = stored(target);
  const audit = immutableRows(target);
  const wrong = await progress(target, { rel: "old.mkv", mediaIdentity: "not-an-occupant" });
  expect(wrong.status).toBe(404);
  expect(stored(target)).toEqual(before);
  expect(immutableRows(target)).toEqual(audit);
  await expectStatus(target.request("/api/library/refresh", { method: "POST" }), 200);
  const entries = await getJson<readonly IdentifiedEntry[]>(target, "/api/list");
  expect(entries.find((entry) => entry.rel === "new.mkv")?.mediaIdentity).toBe(a.mediaIdentity);
  const c = entries.find((entry) => entry.rel === "old.mkv")!;
  if (c.mediaIdentity === undefined) {
    throw new Error("Replacement identity missing");
  }
  expect(c.mediaIdentity).not.toBe(a.mediaIdentity);
  const current = await progress(target, { rel: c.rel, mediaIdentity: c.mediaIdentity });
  expect(current.status).toBe(200);
  expect(await current.json()).toMatchObject({ rel: "old.mkv", position: 42 });
});
