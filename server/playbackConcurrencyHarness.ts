import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PlaybackProgress } from "../shared/types.ts";

const directory = process.argv[2]!;
const [kind, action] = process.argv[3]!.split(":");
const media = join(directory, "media");
await mkdir(join(media, "Old"), { recursive: true });
await mkdir(join(media, "Replacement"));
await writeFile(join(media, "Old/episode.mkv"), "occupant A");
await writeFile(join(media, "Replacement/episode.mkv"), "occupant B");
// The parent sets isolated environment before importing anything that opens SQLite.
const { database } = await import("./database.ts");
const { setPlaybackWatchedState, updatePlaybackProgress, restorePlaybackAuditResponse } = await import("./playback.ts");
const { playbackAuditForUser, playbackProgressForUser } = await import("./playbackAudit.ts");
const { libraryFilesResponse } = await import("./libraryFilesRoutes.ts");
const { entryId, resolveExisting } = await import("./libraryPaths.ts");
database.run("INSERT INTO users (username, is_admin, created_at) VALUES ('viewer', 0, 1)");
const actors = [{ id: 1, username: "admin" }, { id: 2, username: "viewer" }];
let gate: ReturnType<typeof Promise.withResolvers<void>> | null = null;
let reached: ReturnType<typeof Promise.withResolvers<void>> | null = null;
let pauseBoundary = "exists";
let rejectLookup = false;
let onMutation: (() => void) | null = null;
const options = {
  async mediaExists(rel: string) {
    if (rejectLookup) { throw new Error("filesystem validation failed"); }
    const present = await Bun.file(join(media, rel)).exists();
    if (gate !== null && pauseBoundary === "exists") { reached?.resolve(); await gate.promise; }
    return present;
  },
  async mediaIdentity(rel: string) {
    const resolved = await resolveExisting(media, rel);
    const identity = entryId(resolved.stats);
    if (gate !== null && pauseBoundary === "identity") { reached?.resolve(); await gate.promise; }
    return identity;
  },
};
const context = {
  root: media, videoExtensions: new Set([".mkv"]),
  lockSources: { roots: [media], torrents: () => Promise.resolve({ state: "available" as const, payloads: [] }), uploads: () => [] },
  metadataBusy: () => false,
  beginMutation: () => { onMutation?.(); return () => undefined; },
  afterCommit: () => Promise.resolve(undefined),
};
const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
  const url = new URL(req.url);
  const actor = actors[Number(req.headers.get("x-user") ?? "1") - 1]!;
  if (url.pathname.startsWith("/api/library/files")) {
    return libraryFilesResponse({ req, pathname: url.pathname, actor: actors[0]!, context });
  }
  if (url.pathname === "/api/progress/watched") { return setPlaybackWatchedState(req, actor, options); }
  if (url.pathname === "/api/progress") { return updatePlaybackProgress(req, actor, options); }
  return restorePlaybackAuditResponse({ ...options, req, actor, eventId: Number(url.pathname.split("/")[4]) });
}, error(error) { return new Response(error.message, { status: 500 }); } });
const origin = `http://127.0.0.1:${listener.port}`;
interface PendingPlayback { pending: Promise<Response[]> | null }
interface PlaybackBody { rel: string; mediaIdentity?: string }
interface StoredProgress {
  readonly user_id: number;
  readonly rel: string;
  readonly position: number;
  readonly duration: number;
  readonly completed: number;
  readonly updated_at: number;
  readonly dismissed_at: number | null;
}
async function status(pending: Promise<Response>, expected: number) {
  const response = await pending;
  assert.equal(response.status, expected);
}
function request(path: string, body?: unknown, user = 1) {
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json", "x-user": String(user) } };
  if (body !== undefined) { init.body = JSON.stringify(body); }
  return fetch(`${origin}${path}`, init);
}
async function ref(path: string) { return { path, id: entryId(await lstat(join(media, path))) }; }
async function rename(from: string, name: string) {
  return request("/api/library/files/rename", { item: await ref(from), name });
}
async function manager() {
  const item = await ref("Current");
  return action === "trash"
    ? request("/api/library/files/trash", { items: [item] })
    : request("/api/library/files/rename", { item, name: "Final" });
}
function snapshot() {
  return { progress: database.query<StoredProgress, []>("SELECT * FROM playback_progress ORDER BY user_id, rel").all(),
    audit: database.query("SELECT * FROM playback_audit_log ORDER BY id").all(),
    paths: database.query("SELECT * FROM media_path_history ORDER BY id").all() };
}
const restoreIds = new Map<number, number>();
const clearIds = new Map<number, number>();
let identity = "";
function playback(user: number, rel = "Old/episode.mkv", identified = true) {
  if (kind === "restore") { return request(`/api/progress/history/${restoreIds.get(user)!}/restore`, undefined, user); }
  const body: PlaybackBody = { rel };
  if (identified) { body.mediaIdentity = identity; }
  return kind === "watched"
    ? request("/api/progress/watched", { ...body, watched: true }, user)
    : request("/api/progress", { ...body, position: 42, duration: 100, completed: false, event: "started" }, user);
}
function claimedPlayback(actor: typeof actors[number], clear = false) {
  const req = new Request(`${origin}/api/progress`, { method: "POST", body: JSON.stringify({
    rel: "Old/episode.mkv", mediaIdentity: identity, watched: true,
    position: 42, duration: 100, completed: false, event: "started",
  }) });
  if (kind === "restore") {
    return restorePlaybackAuditResponse({ ...options, req, actor, eventId: (clear ? clearIds : restoreIds).get(actor.id)! });
  }
  return kind === "watched" ? setPlaybackWatchedState(req, actor, options) : updatePlaybackProgress(req, actor, options);
}
function expectedAction() {
  if (kind === "progress") { return "playback-started"; }
  return kind === "restore" ? "restored" : "watched";
}
function assertProgress(progress: PlaybackProgress, rel: string) {
  assert.deepEqual({ rel: progress.rel, position: progress.position, duration: progress.duration, completed: progress.completed },
    kind === "progress" ? { rel, position: 42, duration: 100, completed: false } : { rel, position: 0, duration: 0, completed: true });
}
async function assertDisk() {
  const files = await readdir(media, { recursive: true });
  const copies = files.filter((path) => path.endsWith("episode.mkv"));
  const contents = await Promise.all(copies.map(async (path) => [path, await readFile(join(media, path), "utf8")]));
  assert.equal(contents.filter(([, text]) => text === "occupant A").length, 1);
  assert.equal(contents.filter(([, text]) => text === "occupant B").length, 1);
  assert.equal(await Bun.file(join(media, "Old/episode.mkv")).exists(), false);
}
async function validationFailures() {
  const failures: { path: string; body?: unknown; status: number }[] = kind === "restore"
    ? [{ path: "/api/progress/history/0/restore", status: 400 }, { path: "/api/progress/history/9999/restore", status: 404 }]
    : ["Missing/episode.mkv", ".nanime-trash/episode.mkv", "../Current/episode.mkv", "Current/episode.mkv"].map((rel) => ({
      path: kind === "watched" ? "/api/progress/watched" : "/api/progress",
      body: { rel, mediaIdentity: "unknown occupant", watched: true, position: 42, duration: 100, completed: false },
      status: rel.startsWith("../") ? 400 : 404,
    }));
  await failures.reduce<Promise<void>>((previous, failure) => previous.then(async () => {
    const before = snapshot();
    await status(request(failure.path, failure.body), failure.status);
    assert.deepEqual(snapshot(), before, "validation rejection writes neither progress nor audit");
    await status(rename("Current", "Probe"), 200);
    await status(rename("Probe", "Current"), 200);
    return undefined;
  }), Promise.resolve());
  const before = snapshot();
  rejectLookup = true;
  try { await status(playback(1), 500); } finally { rejectLookup = false; }
  assert.deepEqual(snapshot(), before, "filesystem exception writes nothing");
  await status(rename("Current", "Probe"), 200);
  await status(rename("Probe", "Current"), 200);
}
try {
  identity = (await options.mediaIdentity("Old/episode.mkv"))!;
  await actors.reduce<Promise<void>>((previous, actor) => previous.then(async () => {
    await status(request("/api/progress/watched", { rel: "Old/episode.mkv", watched: true }, actor.id), 200);
    await status(request("/api/progress/watched", { rel: "Old/episode.mkv", watched: false }, actor.id), 200);
    const audit = playbackAuditForUser(actor.id, 100, null);
    const restore = audit.find((event) => event.action === "unwatched");
    const clear = audit.find((event) => event.action === "watched");
    assert.ok(restore !== undefined && clear !== undefined, "seeded history contains both watched-state outcomes");
    restoreIds.set(actor.id, restore.id);
    clearIds.set(actor.id, clear.id);
    return undefined;
  }), Promise.resolve());
  await status(rename("Old", "Middle"), 200);
  await status(rename("Middle", "Current"), 200);
  if (action === "failures") { await validationFailures(); }
  const originalRows = snapshot();
  const originals = originalRows.audit;
  // Pause a real filesystem collaborator after validation, before the SQLite mutation.
  for (const actor of actors) {
    gate = Promise.withResolvers<void>(); reached = Promise.withResolvers<void>();
    pauseBoundary = actor.id === 1 || kind === "restore" ? "exists" : "identity";
    const before = snapshot();
    const pending = playback(actor.id, "Old/episode.mkv", actor.id === 2);
    await reached.promise;
    try {
      const blocked = await manager();
      assert.equal(blocked.status, 423, "manager must not move media while playback validates its historical destination");
      assert.deepEqual(snapshot(), before, "rejected manager leaves progress and immutable logs untouched");
      assert.equal(await readFile(join(media, "Current/episode.mkv"), "utf8"), "occupant A");
    } finally { gate.resolve(); gate = null; }
    const saved = await pending;
    assert.equal(saved.status, 200);
    assertProgress(await saved.json() as PlaybackProgress, "Current/episode.mkv");
    assertProgress(playbackProgressForUser(actor.id)[0]!, "Current/episode.mkv");
    const audit = playbackAuditForUser(actor.id, 100, null)[0]!;
    assert.equal(audit.rel, "Current/episode.mkv");
    assert.equal(audit.action, expectedAction());
    assertProgress(audit.next!, "Current/episode.mkv");
    assert.equal(playbackProgressForUser(actor.id).some((row) => row.rel === "Old/episode.mkv"), false);
  }
  // Start a real claimed manager operation first. Playback must fail without a write.
  const beforeManager = snapshot();
  const blockedPlayback: PendingPlayback = { pending: null };
  onMutation = () => {
    const requests = actors.map((actor) => claimedPlayback(actor));
    if (kind === "restore") {
      requests.push(...actors.map((actor) => claimedPlayback(actor, true)));
    }
    blockedPlayback.pending = Promise.all(requests);
  };
  const moved = await manager();
  onMutation = null;
  assert.equal(moved.status, 200);
  const movedResult = await moved.json() as { operationId: string };
  assert.ok(blockedPlayback.pending !== null);
  const blockedResponses = await blockedPlayback.pending;
  await Promise.all(blockedResponses.map(async (response) => {
    assert.equal(response.status, 423, "already claimed manager blocks playback before filesystem validation");
    const body = await response.json() as { message: string };
    assert.ok(body.message.length > 0, "busy error is structured and usable by the caller");
  }));
  assert.deepEqual(snapshot().audit, beforeManager.audit, "rejected playback does not append audit events");
  const afterManager = snapshot().progress;
  assert.equal(afterManager.length, beforeManager.progress.length);
  const expectedRel = action === "trash" ? `.nanime-trash/${movedResult.operationId}/1/Current/episode.mkv` : "Final/episode.mkv";
  const previousByUser = new Map(beforeManager.progress.map((row) => [row.user_id, row]));
  for (const row of afterManager) {
    const previous = previousByUser.get(row.user_id);
    assert.ok(previous !== undefined, "each remapped row belongs to an existing viewer");
    assert.deepEqual(row, { ...previous, rel: expectedRel }, "only the manager remaps progress, preserving its values even in trash for Undo");
  }
  if (action === "reuse") { await status(rename("Replacement", "Current"), 200); }
  const beforeRetry = snapshot();
  await actors.reduce<Promise<void>>((previous, actor) => previous.then(async () => {
    const replay = await playback(actor.id);
    assert.equal(replay.status, action === "trash" ? 404 : 200);
    if (action === "trash") { assert.deepEqual(snapshot(), beforeRetry); } else {
      assertProgress(await replay.json() as PlaybackProgress, "Final/episode.mkv");
      assert.equal(playbackProgressForUser(actor.id).length, 1);
      assertProgress(playbackProgressForUser(actor.id)[0]!, "Final/episode.mkv");
    }
    assert.equal(playbackProgressForUser(actor.id).some((row) => row.rel === "Current/episode.mkv" || row.rel === "Old/episode.mkv"), false);
    return undefined;
  }), Promise.resolve());
  const after = snapshot();
  assert.deepEqual(after.audit.slice(0, originals.length), originals, "pre-move playback audit rows remain byte-for-byte immutable");
  assert.deepEqual(after.paths.slice(0, originalRows.paths.length), originalRows.paths, "existing move history is immutable");
  await assertDisk();
  console.log("playback concurrency passed");
} finally { gate?.resolve(); await listener.stop(true); database.close(); }
