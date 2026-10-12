import assert from "node:assert/strict";
import { mock } from "bun:test";
import originalFs from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as yieldLoop } from "node:timers/promises";

const fs = { ...originalFs };

const directory = process.argv[2]!;
const scenario = process.argv[3]!;
const media = join(directory, "media");
const rel = "Show/episode.mkv";
const id = "00000000-0000-4000-8000-000000000004";
const outputRel = `.nanime-transcodes/${"b".repeat(24)}-${id}.mkv`;
await fs.mkdir(join(media, "Show"), { recursive: true });
const video = Bun.spawn(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=size=32x32:rate=2", "-t", "1", "-c:v", "libx264", join(media, rel)], { stdout: "ignore", stderr: "pipe" });
assert.equal(await video.exited, 0, await new Response(video.stderr).text());
const original = await fs.readFile(join(media, rel));
const { database } = await import("./database.ts");
const options = { mediaDir: media, mediaRoot: media, videoExtensions: new Set([".mkv"]) };
const actor = { id: 1, username: "admin" };
const gates = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
const seen = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
const observedStages = new Set<string>();
for (const key of ["resolve", "output", "ffprobe", "ffmpeg", "cancel-exit", "cleanup", "validation", "progress-ready"]) {
  gates.set(key, Promise.withResolvers<void>()); seen.set(key, Promise.withResolvers<void>());
}
function gate(key: string) {
  const value = gates.get(key); assert.ok(value); return value;
}
function observation(key: string) {
  const value = seen.get(key); assert.ok(value); return value;
}
async function barrier(key: string) { observedStages.add(key); observation(key).resolve(); await gate(key).promise; }
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  const { pathname } = new URL(req.url);
  if (pathname.startsWith("/api/")) { return Response.json([]); }
  await barrier(pathname.slice(1)); return new Response("continue");
} });
process.env["QBITTORRENT_URL"] = `http://127.0.0.1:${server.port}`;
await fs.writeFile(join(directory, "control.json"), JSON.stringify({ origin: `http://127.0.0.1:${server.port}`, failProgress: scenario === "progress-failure" }));
let filesystemBarrier = scenario === "resolve" ? "resolve" : "";
if (scenario === "output" || scenario === "queued-delete") { filesystemBarrier = "output"; }
// Delay only the first selected real filesystem operation; delegate unchanged
// to the actual filesystem, retaining SQLite and all physical outcomes.
mock.module("node:fs/promises", () => ({ ...fs,
  async lstat(path: Parameters<typeof fs.lstat>[0]) {
    if (filesystemBarrier === "resolve" && path === join(media, rel)) { filesystemBarrier = ""; await barrier("resolve"); }
    return fs.lstat(path);
  },
  async realpath(path: Parameters<typeof fs.realpath>[0]) {
    if (filesystemBarrier === "output" && path === join(media, ".nanime-transcodes")) { filesystemBarrier = ""; await barrier("output"); }
    return fs.realpath(path);
  },
  async unlink(path: Parameters<typeof fs.unlink>[0]) {
    if (filesystemBarrier === "cleanup" && path === join(media, outputRel)) { filesystemBarrier = ""; await barrier("cleanup"); }
    return fs.unlink(path);
  },
}));
function seed(jobId: string, source: string, output: string) {
  database.run(`INSERT INTO transcode_jobs (id, source_rel, preset, output_rel, status, input_size, created_at, updated_at) VALUES (?, ?, 'compatibility', ?, 'queued', ?, 1, 1)`, [jobId, source, output, original.length]);
}
if (!scenario.startsWith("handoff")) { seed(id, rel, outputRel); }
if (scenario === "resolve" || scenario === "output" || scenario === "probe" || scenario === "queued-delete") {
  await fs.mkdir(join(media, ".nanime-transcodes"));
  await fs.writeFile(join(media, outputRel), "interrupted partial output");
}
const { transcodeResponse } = await import("./transcodes.ts");
const { performLibraryFileOperation } = await import("./libraryFileOperations.ts");
const { entryId } = await import("./libraryPaths.ts");
const { deleteMediaResponse } = await import("./mediaDelete.ts");
const { claimLibraryPaths, libraryPathBusy } = await import("./libraryWriters.ts");
const { localLocks } = await import("./libraryLocks.ts");
const { waitForWriterOutcome } = await import("./libraryWriterTestTools.ts");
function request(method: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) { init.body = JSON.stringify(body); }
  return new Request("http://nanime.test/api", init);
}
function row(jobId = id) { return database.query<{ readonly status: string; readonly started_at: number | null }, [string]>("SELECT status, started_at FROM transcode_jobs WHERE id = ?").get(jobId)!; }
async function renameEpisode() {
  const stats = await fs.lstat(join(media, rel));
  return performLibraryFileOperation({ actor, context: { root: media, videoExtensions: options.videoExtensions,
    lockSources: { roots: [media], torrents: () => Promise.resolve({ state: "unconfigured", payloads: [] }), uploads: () => [] },
    metadataBusy: () => false, beginMutation: () => () => undefined, afterCommit: () => Promise.resolve(undefined),
  }, request: { type: "rename", item: { path: rel, id: entryId(stats) }, name: "renamed.mkv" } });
}
async function blocked() {
  await assert.rejects(renameEpisode(), (error: unknown) => (error as { status: number }).status === 423);
  const deleting = await deleteMediaResponse(request("POST", { paths: [rel] }), { ...options, actor });
  assert.equal(deleting.status, 423, "legacy destructive writer rejects cancelled but unsettled worker");
  assert.deepEqual(await fs.readFile(join(media, rel)), original);
  assert.ok(localLocks({ uploads: () => [] }).some((lock) => lock.path === rel && lock.lock.source === "transcode"), "cancelled worker remains visibly busy");
}
async function settled() {
  const deadline = performance.now() + 10_000;
  while (libraryPathBusy(rel)) { assert.ok(performance.now() < deadline, "worker failed to settle"); await yieldLoop(); }
  assert.equal(row().status, "cancelled");
  await renameEpisode();
  assert.deepEqual(await fs.readFile(join(media, "Show/renamed.mkv")), original);
  const removed = await deleteMediaResponse(request("POST", { paths: ["Show/renamed.mkv"] }), { ...options, actor });
  assert.equal(removed.status, 200);
  assert.equal(await Bun.file(join(media, "Show/renamed.mkv")).exists(), false);
}
async function queuedDeletion() {
  const release = claimLibraryPaths([rel]);
  const pending = transcodeResponse(request("DELETE"), `/api/transcodes/${id}`, options);
  await observation("output").promise;
  release();
  await transcodeResponse(request("GET"), "/api/transcodes", options);
  gate("output").resolve();
  const deleted = await pending;
  assert.equal(deleted.status, 204);
  assert.equal(database.query("SELECT id FROM transcode_jobs WHERE id = ?").get(id), null);
  await renameEpisode();
  assert.deepEqual(await fs.readFile(join(media, "Show/renamed.mkv")), original);
  assert.equal(await Bun.file(join(media, outputRel)).exists(), false);
}
async function progressFailure() {
  database.run("CREATE TRIGGER fail_encoder_progress BEFORE UPDATE OF progress ON transcode_jobs WHEN NEW.progress > 0 BEGIN SELECT RAISE(ABORT, 'controlled progress persistence failure'); END");
  await transcodeResponse(request("GET"), "/api/transcodes", options);
  await observation("ffprobe").promise;
  gate("ffprobe").resolve();
  await observation("ffmpeg").promise;
  await fs.writeFile(join(media, outputRel), "partial encoder bytes");
  gate("ffmpeg").resolve();
  await observation("progress-ready").promise;
  await waitForWriterOutcome(() => observedStages.has("cancel-exit") || row().status === "failed");
  await blocked();
  gate("cancel-exit").resolve(); gate("progress-ready").resolve();
  await waitForWriterOutcome(() => !libraryPathBusy(rel));
  assert.equal(row().status, "failed");
  await renameEpisode();
  assert.deepEqual(await fs.readFile(join(media, "Show/renamed.mkv")), original);
}
async function failedAdmission() {
  const release = claimLibraryPaths([rel]);
  await transcodeResponse(request("GET"), "/api/transcodes", options);
  assert.equal(row().status, "queued"); assert.equal(row().started_at, null);
  assert.equal(await Bun.file(join(media, ".nanime-transcodes")).exists(), false);
  const other = "00000000-0000-4000-8000-000000000006";
  await fs.mkdir(join(media, "Other"));
  await fs.writeFile(join(media, "Other/second.mkv"), original);
  seed(other, "Other/second.mkv", `.nanime-transcodes/${"c".repeat(24)}-${other}.mkv`);
  await transcodeResponse(request("GET"), "/api/transcodes", options);
  await observation("ffprobe").promise;
  assert.equal(row().status, "queued", "failed source reservation cannot mark the job active or consume worker capacity");
  assert.equal(row(other).status, "processing", "unrelated worker can use the free capacity");
  await transcodeResponse(request("POST"), `/api/transcodes/${other}/cancel`, options);
  gate("ffprobe").resolve();
  const deadline = performance.now() + 10_000;
  while (libraryPathBusy("Other/second.mkv")) { assert.ok(performance.now() < deadline); await yieldLoop(); }
  // Re-arm the same probe stage for the formerly blocked job.
  gates.set("ffprobe", Promise.withResolvers<void>()); seen.set("ffprobe", Promise.withResolvers<void>());
  release();
}
async function queuedUnstarted() {
  const second = "00000000-0000-4000-8000-000000000005";
  await fs.writeFile(join(media, "Show/second.mkv"), original);
  seed(second, "Show/second.mkv", `.nanime-transcodes/${"c".repeat(24)}-${second}.mkv`);
  database.run("UPDATE transcode_jobs SET created_at = 2 WHERE id = ?", [second]);
  await transcodeResponse(request("GET"), "/api/transcodes", options);
  await observation("ffprobe").promise;
  assert.equal(row(second).started_at, null);
  const cancelledSecond = await transcodeResponse(request("POST"), `/api/transcodes/${second}/cancel`, options);
  assert.equal(cancelledSecond.status, 200);
  assert.equal(row(second).status, "cancelled");
  const removed = await deleteMediaResponse(request("POST", { paths: ["Show/second.mkv"] }), { ...options, actor });
  assert.equal(removed.status, 200, "unstarted queued cancellation has no worker lifetime to retain");
  await transcodeResponse(request("POST"), `/api/transcodes/${id}/cancel`, options);
  gate("ffprobe").resolve(); await settled();
}
async function launchFixtureJob(): Promise<string> {
  let jobId = id;
  if (scenario.startsWith("handoff")) {
    const bulk = scenario === "handoff-bulk";
    const body = bulk ? { paths: [rel], preset: "compatibility" } : { path: rel, preset: "compatibility" };
    const response = await transcodeResponse(request("POST", body), bulk ? "/api/transcodes/bulk" : "/api/transcodes", options);
    assert.equal(response.status, 201);
    const result = await response.json() as { readonly id: string } | readonly { readonly id: string }[];
    jobId = Array.isArray(result) ? result[0].id : (result as { readonly id: string }).id;
  } else { await transcodeResponse(request("GET"), "/api/transcodes", options); }
  return jobId;
}
async function cancelAtBarrier(jobId: string): Promise<{ stage: string; cancelled: Response }> {
  const stage = scenario === "resolve" || scenario === "output" ? scenario : "ffprobe";
  await observation(stage).promise;
  assert.ok(row(jobId).status === "queued" || row(jobId).status === "processing", "admitted job remains live at the cancellation barrier");
  if (scenario === "processing-exit" || scenario === "cleanup") {
    gate("ffprobe").resolve(); await observation("ffmpeg").promise;
    await fs.writeFile(join(media, outputRel), "partial encoder bytes");
    if (scenario === "cleanup") { filesystemBarrier = "cleanup"; }
  }
  if (scenario === "validation") {
    gate("ffprobe").resolve(); gate("ffmpeg").resolve();
    await observation("validation").promise;
    const encoded = await fs.readFile(join(media, outputRel));
    assert.ok(encoded.length > 0, "real encoder produced an output before validation cancellation");
  }
  const cancelled = await transcodeResponse(request("POST"), `/api/transcodes/${jobId}/cancel`, options);
  return { stage, cancelled };
}
async function releaseCancellation(stage: string) {
  if (scenario === "resolve" || scenario === "output") {
    gate(stage).resolve();
  } else if (scenario === "processing-exit" || scenario === "cleanup") {
    await observation("cancel-exit").promise; await blocked();
    gate("cancel-exit").resolve();
    if (scenario === "cleanup") {
      await observation("cleanup").promise; await blocked();
      assert.equal(await fs.readFile(join(media, outputRel), "utf8"), "partial encoder bytes");
      gate("cleanup").resolve();
    }
  } else if (scenario === "validation") { gate("validation").resolve(); }
  else { gate("ffprobe").resolve(); }
}
async function verifyCancelled(jobId: string) {
  if (scenario.startsWith("handoff")) {
    const deadline = performance.now() + 10_000;
    while (libraryPathBusy(rel)) { assert.ok(performance.now() < deadline); await yieldLoop(); }
    assert.equal(row(jobId).status, "cancelled"); await renameEpisode();
  } else {
    await settled();
    if (scenario === "resolve" || scenario === "output") { assert.equal(row().started_at, null, "cancel during resolution never enters processing"); }
    assert.equal(await Bun.file(join(media, outputRel)).exists(), false, "cancelled worker removes partial output");
  }
}
async function cancellationScenarios() {
  if (scenario === "failed-admission") { await failedAdmission(); }
  if (scenario === "queued-unstarted") { await queuedUnstarted(); return; }
  const jobId = await launchFixtureJob();
  const { stage, cancelled } = await cancelAtBarrier(jobId);
  assert.equal(cancelled.status, 200);
  assert.equal(row(jobId).status, "cancelled");
  await blocked();
  await releaseCancellation(stage);
  await verifyCancelled(jobId);
}
try {
  if (scenario === "queued-delete") { await queuedDeletion(); }
  else if (scenario === "progress-failure") { await progressFailure(); }
  else { await cancellationScenarios(); }
  console.log("transcode lifetime passed");
} finally { for (const held of gates.values()) { held.resolve(); } server.stop(true); }
