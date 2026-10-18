import assert from "node:assert/strict";
import { lstat, mkdir, readFile, rename, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { controlledWriterTools, makeWriterVideo, waitForWriterOutcome } from "./libraryWriterTestTools.ts";

const directory = process.argv[2]!;
const scenario = process.argv[3]!;
const media = join(directory, "media");
const rel = "Show/episode.mkv";
const oldId = "00000000-0000-4000-8000-000000000002";
await mkdir(join(media, "Show"), { recursive: true });
await writeFile(join(media, rel), "original");
let barrier: ReturnType<typeof Promise.withResolvers<void>> | null = null;
let observed: ReturnType<typeof Promise.withResolvers<void>> | null = null;
const qbPayloads: { readonly hash: string; readonly name: string; readonly content_path: string; readonly progress: number; readonly state: string; readonly tags: string }[] = [];
const delayedQbPayloads: typeof qbPayloads = [];
let delayedListings = 0;
// Like a magnet the client is still registering: absent from the first listing
// after the add, present from the next one on.
// "torrent-late" stays hidden until the add-time observation window has closed.
let lateTorrentListed = scenario !== "torrent-late";
function releaseDelayedPayloads(): void {
  if (delayedQbPayloads.length > 0 && (delayedListings += 1) > 1 && lateTorrentListed) {
    qbPayloads.push(...delayedQbPayloads.splice(0));
  }
}
const RECORDED_ADDS = new Set(["torrent-visible", "torrent-visible-alias", "torrent-delayed", "torrent-late"]);
const DELAYED_ADDS = new Set(["torrent-delayed", "torrent-late"]);
const qb = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  if (barrier !== null) {
    observed?.resolve();
    await barrier.promise;
  }
  const { pathname } = new URL(req.url);
  if (scenario === "torrent-outage") { return new Response("offline", { status: 503 }); }
  if (pathname.endsWith("/add")) {
    if (RECORDED_ADDS.has(scenario)) {
      const form = await req.formData();
      (DELAYED_ADDS.has(scenario) ? delayedQbPayloads : qbPayloads).push({ hash: "a".repeat(40), name: "Example torrent", content_path: scenario === "torrent-visible-alias" ? join(media, "Alias/episode.mkv") : join(media, rel), progress: 1, state: "uploading", tags: String(form.get("tags")) });
    }
    return new Response("Ok.");
  }
  if (pathname.endsWith("/delete")) {
    const body = new URLSearchParams(await req.text());
    assert.equal(body.get("deleteFiles"), "false");
    const hashes = new Set(body.get("hashes")?.split("|"));
    for (let index = qbPayloads.length - 1; index >= 0; index -= 1) {
      if (hashes.has(qbPayloads[index]!.hash)) { qbPayloads.splice(index, 1); }
    }
    return new Response("Ok.");
  }
  releaseDelayedPayloads();
  return Response.json(qbPayloads);
} });
process.env["QBITTORRENT_URL"] = `http://127.0.0.1:${qb.port}`;
const { claimLibraryPaths } = await import("./libraryWriters.ts");
const { deleteMediaResponse } = await import("./mediaDelete.ts");
const { mediaUploadResponse } = await import("./mediaUpload.ts");
const { deleteAudioTrackResponse } = await import("./audioTracks.ts");
const { pruneTracksResponse } = await import("./trackPruning.ts");
const { subtitleUploadResponse } = await import("./subtitles.ts");
const { offlineMediaApiResponse, offlineMediaFileResponse } = await import("./offlineMedia.ts");
const { transcodeResponse } = await import("./transcodes.ts");
const { torrentsResponse, torrentOwnership } = await import("./torrents.ts");
const { database } = await import("./database.ts");
const { performLibraryFileOperation } = await import("./libraryFileOperations.ts");
const { entryId } = await import("./libraryPaths.ts");
const options = { mediaDir: media, mediaRoot: media, videoExtensions: new Set([".mkv", ".mp4"]) };
const offlineOptions = { ...options, directPlayExtensions: new Set([".mp4"]) };
const actor = { id: 1, username: "admin" };
function request(body: unknown): Request {
  return new Request("http://nanime.test/api", { method: "POST", body: JSON.stringify(body) });
}
function subtitleRequest(path: string): Request {
  const form = new FormData();
  form.set("path", path); form.set("offsetSeconds", "0");
  form.set("subtitle", new File(["1\n00:00:00,000 --> 00:00:01,000\nHello\n"], "English.srt"));
  return new Request("http://nanime.test/api/subtitles", { method: "POST", body: form });
}
function torrentRequest(): Request {
  const form = new FormData();
  form.set("showFolder", "Show");
  form.set("magnet", `magnet:?xt=urn:btih:${"a".repeat(40)}`);
  return new Request("http://nanime.test/api/torrents", { method: "POST", body: form });
}
const writers = {
  delete: (path: string) => deleteMediaResponse(request({ paths: [path] }), { ...options, actor }),
  audio: (path: string) => deleteAudioTrackResponse(request({ path, index: 1 }), { ...options, invalidateSubtitles: () => undefined }),
  prune: (path: string) => pruneTracksResponse(request({ operations: [{ path, audioIndices: [], subtitleIndices: [] }] }), options),
  subtitle: (path: string) => subtitleUploadResponse(subtitleRequest(path), media, options.videoExtensions),
  offline: async (path: string) => await offlineMediaApiResponse(request({ path }), "/api/offline-media", offlineOptions) as Response,
  transcode: async (path: string) => await transcodeResponse(request({ path, preset: "compatibility" }), "/api/transcodes", options),
};
async function renameEpisode() {
  const stats = await lstat(join(media, rel));
  return performLibraryFileOperation({
    actor,
    context: {
      root: media, videoExtensions: options.videoExtensions,
      lockSources: { roots: [media], torrents: () => Promise.resolve({ state: "available", payloads: [] }), uploads: () => [] },
      metadataBusy: () => false, beginMutation: () => () => undefined, afterCommit: () => Promise.resolve(undefined),
    },
    request: { type: "rename", item: { path: rel, id: entryId(stats) }, name: "renamed.mkv" },
  });
}
try {
  const selectedWriter = Object.entries(writers).find(([name]) => name === scenario)?.[1];
  if (selectedWriter !== undefined) {
    const release = claimLibraryPaths([rel]);
    try {
      const response = await selectedWriter(rel);
      assert.equal(response.status, 423, `${scenario}: manager claim prevents writer admission`);
      assert.equal(await readFile(join(media, rel), "utf8"), "original");
      assert.equal(database.query<{ readonly n: number }, []>("SELECT count(*) AS n FROM transcode_jobs").get()?.n, 0);
      assert.equal(database.query<{ readonly n: number }, []>("SELECT count(*) AS n FROM offline_media_artifacts").get()?.n, 0);
    } finally { release(); }
  } else if (scenario === "aliases") {
    await makeWriterVideo(join(media, rel), true);
    const before = await readFile(join(media, rel));
    await symlink(join(media, "Show"), join(media, "Alias"));
    await Promise.all(["Show/./episode.mkv", "Show/../Show/episode.mkv", join(media, rel), "Alias/episode.mkv"].map(async (path) => {
      await Promise.all(Object.entries(writers).map(async ([name, writer]) => {
        const response = await writer(path);
        assert.ok(response.status >= 400 && response.status < 500, `${name} must reject alias ${path}; got ${response.status}`);
      }));
      const bulk = await transcodeResponse(request({ paths: [path], preset: "compatibility" }), "/api/transcodes/bulk", options);
      assert.ok(bulk.status >= 400 && bulk.status < 500, "bulk admission rejects aliases too");
    }));
    assert.equal(database.query<{ readonly n: number }, []>("SELECT count(*) AS n FROM transcode_jobs").get()?.n, 0);
    assert.equal(database.query<{ readonly n: number }, []>("SELECT count(*) AS n FROM offline_media_artifacts").get()?.n, 0);
    assert.deepEqual(await readFile(join(media, rel)), before);
  } else if (scenario === "trash") {
    await mkdir(join(media, ".nanime-trash"));
    const trash = join(media, ".nanime-trash", "secret.mp4");
    await writeFile(trash, "secret");
    await symlink(trash, join(media, "visible.mp4"));
    const response = await writers["offline"]!("visible.mp4");
    assert.ok(response.status >= 400, "visible symlink into trash cannot be prepared");
    const stats = await lstat(trash);
    const id = "00000000-0000-4000-8000-000000000001";
    database.run(`INSERT INTO offline_media_artifacts (id, source_rel, source_size, source_modified_at, audio_index, direct, status, duration, size_bytes, mime_type, created_at, updated_at) VALUES (?, ?, ?, ?, -1, 1, 'ready', 0, ?, 'video/mp4', 1, 1)`, [id, "visible.mp4", stats.size, stats.mtimeMs, stats.size]);
    const stream = await offlineMediaFileResponse(id, new Request("http://nanime.test/media"), offlineOptions);
    assert.ok(stream.status >= 400, "old artifact rows cannot stream a visible trash alias");
  } else if (scenario === "writer-first") {
    barrier = Promise.withResolvers<void>(); observed = Promise.withResolvers<void>();
    const deleting = writers["delete"]!(rel);
    await observed.promise;
    await assert.rejects(renameEpisode(), (error: unknown) => (error as { status: number }).status === 423);
    assert.equal(await readFile(join(media, rel), "utf8"), "original");
    barrier.resolve(); barrier = null;
    const deleted = await deleting;
    assert.equal(deleted.status, 200);
    assert.equal(await Bun.file(join(media, rel)).exists(), false);
  } else if (scenario === "torrent") {
    const release = claimLibraryPaths(["Show"]);
    try {
      const response = await torrentsResponse(torrentRequest(), media, new URL("http://nanime.test/api/torrents"));
      assert.equal(response.status, 423, "torrent addition cannot start after a manager scope claim");
    } finally { release(); }
    barrier = Promise.withResolvers<void>(); observed = Promise.withResolvers<void>();
    const adding = torrentsResponse(torrentRequest(), media, new URL("http://nanime.test/api/torrents"));
    await observed.promise;
    await assert.rejects(renameEpisode(), (error: unknown) => (error as { status: number }).status === 423);
    barrier.resolve(); barrier = null;
    const response = await adding;
    assert.equal(response.status, 502, "unobservable ownership must not return fabricated success");
    await assert.rejects(renameEpisode(), (error: unknown) => (error as { status: number }).status === 423);
    assert.equal(await readFile(join(media, rel), "utf8"), "original");
    const recovered = Bun.spawn([process.execPath, import.meta.path, directory, "torrent-recovered"], { env: process.env, stdout: "pipe", stderr: "pipe" });
    const recoveryError = await new Response(recovered.stderr).text();
    assert.equal(await recovered.exited, 0, recoveryError);
    assert.equal(await new Response(recovered.stdout).text(), "writer regressions passed\n");
  } else if (scenario === "torrent-recovered") {
    await assert.rejects(renameEpisode(), (error: unknown) => (error as { status: number }).status === 423);
  } else if (scenario === "torrent-visible" || scenario === "torrent-visible-alias" || scenario === "torrent-delayed") {
    await visibleTorrentRegression();
  } else if (scenario === "torrent-late") {
    await lateTorrentRegression();
  } else if (scenario === "torrent-outage") {
    await torrentOutageRegression();
  } else if (scenario === "upload") {
    await uploadRegression();
  } else if (scenario === "detach-alias") {
    await symlink(join(media, "Show"), join(media, "Alias"));
    qbPayloads.push({ hash: "a".repeat(40), name: "Seeding alias", content_path: join(media, "Alias/episode.mkv"), progress: 1, state: "uploading", tags: "" });
    const deleted = await writers.delete(rel);
    assert.equal(deleted.status, 200);
    assert.equal(qbPayloads.length, 0, "canonical payload must be detached before the library file is deleted");
    assert.equal(await Bun.file(join(media, rel)).exists(), false);
  } else if (scenario.startsWith("offline-")) {
    await offlineSetupRegression(scenario);
  } else if (scenario === "audio-first" || scenario === "prune-first") {
    await rewriteRegression(scenario);
  } else if (scenario === "promotion") {
    await promotionRegression();
  } else if (scenario === "transcode-canonical") {
    await transcodeCanonicalRegression();
  } else { throw new Error(`Unknown regression ${scenario}`); }
  console.log("writer regressions passed");
} finally { barrier?.resolve(); qb.stop(true); }

async function offlineSetupRegression(mode: string): Promise<void> {
  await makeWriterVideo(join(media, rel));
  await utimes(join(media, rel), new Date(1000), new Date(1000));
  const stats = await lstat(join(media, rel));
  if (mode === "offline-requeue") {
    database.run(`INSERT INTO offline_media_artifacts (id, source_rel, source_size, source_modified_at, audio_index, direct, output_name, status, duration, mime_type, created_at, updated_at) VALUES (?, ?, ?, ?, -1, 0, ?, 'failed', 1, 'video/mp4', 1, 1)`, [oldId, rel, stats.size, stats.mtimeMs, `${oldId}.mp4`]);
  }
  const tools = await controlledWriterTools(directory);
  try {
    const preparing = writers.offline(rel);
    await tools.probeStarted;
    await assert.rejects(renameEpisode(), (error: unknown) => (error as { status: number }).status === 423);
    if (mode === "offline-replaced") {
      const replacement = join(media, "replacement.mkv");
      await writeFile(replacement, await readFile(join(media, rel)));
      await utimes(replacement, stats.atime, stats.mtime);
      await rename(replacement, join(media, rel));
      tools.releaseProbe();
      const response = await preparing;
      assert.equal(response.status, 409, "a replaced inode cannot admit a stale offline job");
      assert.equal(database.query<{ readonly n: number }, []>("SELECT count(*) AS n FROM offline_media_artifacts").get()?.n, 0);
      await renameEpisode();
      return;
    }
    tools.releaseProbe();
    const response = await preparing;
    assert.equal(response.status, 202);
    const artifact = await response.json() as { readonly id: string; readonly path: string };
    assert.equal(artifact.path, rel);
    if (mode === "offline-requeue") { assert.equal(artifact.id, oldId); }
    await tools.encoderStarted;
    await assert.rejects(renameEpisode(), (error: unknown) => (error as { status: number }).status === 423);
    const deleting = await writers.delete(rel);
    assert.equal(deleting.status, 423, "persisted job also prevents legacy destructive writers");
    tools.releaseEncoder();
    await waitForWriterOutcome(() => database.query<{ readonly status: string }, [string]>("SELECT status FROM offline_media_artifacts WHERE id = ?").get(artifact.id)?.status === "ready");
    const streamed = await offlineMediaFileResponse(artifact.id, new Request("http://nanime.test/media"), offlineOptions);
    assert.equal(streamed.status, 200);
    const bytes = await streamed.arrayBuffer();
    assert.ok(bytes.byteLength > 0, "real prepared output streams after completion");
    await renameEpisode();
  } finally { tools.close(); }
}

async function rewriteRegression(mode: string): Promise<void> {
  await makeWriterVideo(join(media, rel), true);
  const [before, subtitle] = await Promise.all([readFile(join(media, rel)), writers.subtitle(rel)]);
  assert.equal(subtitle.status, 200, "ordinary subtitle uploads still succeed");
  const tools = await controlledWriterTools(directory);
  tools.releaseEncoder();
  barrier = Promise.withResolvers<void>(); observed = Promise.withResolvers<void>();
  const rewriting = mode === "audio-first" ? writers.audio(rel) : pruneTracksResponse(request({
    operations: [{ path: rel, audioIndices: [1], subtitleIndices: [-1] }],
  }), options);
  try {
    await tools.probeStarted;
    await assert.rejects(renameEpisode(), (error: unknown) => (error as { status: number }).status === 423);
    tools.releaseProbe();
    await observed.promise;
    await assert.rejects(renameEpisode(), (error: unknown) => (error as { status: number }).status === 423);
    assert.deepEqual(await readFile(join(media, rel)), before);
    barrier.resolve(); barrier = null;
    const result = await rewriting;
    assert.equal(result.status, 200);
    const { audioTracks } = await import("./audioTracks.ts");
    const tracks = await audioTracks(join(media, rel));
    assert.equal(tracks.length, 1, "real remux removed exactly one audio track");
    if (mode === "prune-first") {
      const { subtitleTracks } = await import("./subtitles.ts");
      const remainingSubtitles = await subtitleTracks(join(media, rel));
      assert.equal(remainingSubtitles.length, 0, "selected sidecar was removed");
    }
    await renameEpisode();
  } finally { tools.close(); }
}

async function promotionRegression(): Promise<void> {
  const id = "00000000-0000-4000-8000-000000000003";
  const outputRel = `.nanime-transcodes/${"a".repeat(24)}-${id}.mkv`;
  await mkdir(join(media, ".nanime-transcodes"));
  await makeWriterVideo(join(media, outputRel));
  const optimized = await readFile(join(media, outputRel));
  database.run(`INSERT INTO transcode_jobs (id, source_rel, preset, output_rel, status, input_size, created_at, updated_at) VALUES (?, ?, 'compatibility', ?, 'complete', 8, 1, 1)`, [id, rel, outputRel]);
  const path = `/api/transcodes/${id}/original`;
  const remove = () => transcodeResponse(new Request(`http://nanime.test${path}`, { method: "DELETE" }), path, options);
  const release = claimLibraryPaths([rel]);
  try {
    const response = await remove();
    assert.equal(response.status, 423);
    assert.deepEqual(await readFile(join(media, outputRel)), optimized);
  } finally { release(); }
  barrier = Promise.withResolvers<void>(); observed = Promise.withResolvers<void>();
  const promoting = remove();
  await observed.promise;
  await assert.rejects(renameEpisode(), (error: unknown) => (error as { status: number }).status === 423);
  barrier.resolve(); barrier = null;
  const response = await promoting;
  assert.equal(response.status, 200);
  assert.equal(await Bun.file(join(media, rel)).exists(), false);
  assert.deepEqual(await readFile(join(media, "Show/episode.compatibility.mkv")), optimized);
  const row = database.query<{ readonly output_rel: string; readonly original_deleted: number }, [string]>("SELECT output_rel, original_deleted FROM transcode_jobs WHERE id = ?").get(id);
  assert.deepEqual(row, { output_rel: "Show/episode.compatibility.mkv", original_deleted: 1 });
}

async function torrentOutageRegression(): Promise<void> {
  const response = await torrentsResponse(torrentRequest(), media, new URL("http://nanime.test/api/torrents"));
  assert.equal(response.status, 502);
  const stats = await lstat(join(media, "Show"));
  const result = await performLibraryFileOperation({ actor, context: {
    root: media, videoExtensions: options.videoExtensions,
    lockSources: { roots: [media], torrents: torrentOwnership, uploads: () => [] },
    metadataBusy: () => false, beginMutation: () => () => undefined, afterCommit: () => Promise.resolve(undefined),
  }, request: { type: "create-folder", parent: { path: "Show", id: entryId(stats) }, name: "Harmless folder" } });
  assert.equal(result.kind, "create-folder");
  assert.equal(database.query<{ readonly n: number }, []>("SELECT count(*) AS n FROM library_torrent_additions").get()?.n, 0);
}

async function uploadRegression(): Promise<void> {
  const uploadOptions = { mediaRoot: media, videoExtensions: options.videoExtensions, userId: 1, username: "admin" };
  const path = "/api/media/uploads";
  const uploadBody = { fileName: "uploaded.mkv", folder: "Show", size: 8 };
  const release = claimLibraryPaths(["Show"]);
  try {
    const response = await mediaUploadResponse(request(uploadBody), path, uploadOptions);
    assert.equal(response.status, 423);
  } finally { release(); }
  const started = await mediaUploadResponse(request(uploadBody), path, uploadOptions);
  assert.equal(started.status, 200);
  const { id } = await started.json() as { readonly id: string };
  const folderStats = await lstat(join(media, "Show"));
  const renameShow = () => performLibraryFileOperation({ actor, context: {
    root: media, videoExtensions: options.videoExtensions,
    lockSources: { roots: [media], torrents: () => Promise.resolve({ state: "available", payloads: [] }), uploads: () => [] },
    metadataBusy: () => false, beginMutation: () => () => undefined, afterCommit: () => Promise.resolve(undefined),
  }, request: { type: "rename", item: { path: "Show", id: entryId(folderStats) }, name: "Renamed Show" } });
  await assert.rejects(renameShow(), (error: unknown) => (error as { status: number }).status === 423);
  const rewriting = await writers.subtitle(rel);
  assert.equal(rewriting.status, 423, "sibling writer cannot race an active upload destination");
  const chunk = new FormData(); chunk.set("offset", "0"); chunk.set("chunk", new File(["uploaded"], "chunk"));
  const appended = await mediaUploadResponse(new Request("http://nanime.test/api", { method: "POST", body: chunk }), `${path}/${id}`, uploadOptions);
  assert.equal(appended.status, 200);
  const completed = await mediaUploadResponse(request({}), `${path}/${id}/complete`, uploadOptions);
  assert.equal(completed.status, 200);
  assert.equal(await readFile(join(media, "Show/uploaded.mkv"), "utf8"), "uploaded");
  await renameShow();
  assert.equal(await readFile(join(media, "Renamed Show/uploaded.mkv"), "utf8"), "uploaded");
}

function lockedStatus(paths: readonly string[]): number | null {
  try {
    claimLibraryPaths(paths)();
    return null;
  } catch (error) {
    return (error as { status: number }).status;
  }
}

async function lateTorrentRegression(): Promise<void> {
  const response = await torrentsResponse(torrentRequest(), media, new URL("http://nanime.test/api/torrents"));
  assert.equal(response.status, 502, "a torrent still hidden after the add window stays pending");
  assert.equal(lockedStatus(["Show/extra.mkv"]), 423);
  lateTorrentListed = true;
  // No library write reads ownership here; only background reconciliation can observe the payload.
  const deadline = Date.now() + 5000;
  while (lockedStatus(["Show/extra.mkv"]) !== null && Date.now() < deadline) {
    await Bun.sleep(50);
  }
  assert.equal(lockedStatus(["Show/extra.mkv"]), null, "reconciliation releases the pending reservation once qBittorrent lists the payload");
  assert.equal(lockedStatus(["Show"]), 423);
}

async function visibleTorrentRegression(): Promise<void> {
  if (scenario === "torrent-visible-alias") { await symlink(join(media, "Show"), join(media, "Alias")); }
  const response = await torrentsResponse(torrentRequest(), media, new URL("http://nanime.test/api/torrents"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { added: true });
  // This deliberately stale empty ownership snapshot must not bypass the
  // synchronous handoff from pending scope to observed payload ownership.
  await assert.rejects(renameEpisode(), (error: unknown) => (error as { status: number }).status === 423);
  const stats = await lstat(join(media, "Show"));
  const result = await performLibraryFileOperation({ actor, context: {
    root: media, videoExtensions: options.videoExtensions,
    lockSources: { roots: [media], torrents: torrentOwnership, uploads: () => [] },
    metadataBusy: () => false, beginMutation: () => () => undefined, afterCommit: () => Promise.resolve(undefined),
  }, request: { type: "create-folder", parent: { path: "Show", id: entryId(stats) }, name: "New folder" } });
  assert.equal(result.kind, "create-folder", "observed payload ownership releases the broader save-folder reservation");
  qbPayloads.length = 0;
  await torrentOwnership();
  await renameEpisode();
  assert.equal(await readFile(join(media, "Show/renamed.mkv"), "utf8"), "original");
  assert.equal(database.query<{ readonly n: number }, []>("SELECT count(*) AS n FROM library_torrent_additions").get()?.n, 0);
}

async function transcodeCanonicalRegression(): Promise<void> {
  await makeWriterVideo(join(media, rel));
  const tools = await controlledWriterTools(directory);
  tools.releaseProbe();
  try {
    const response = await writers.transcode(rel);
    assert.equal(response.status, 201);
    const job = await response.json() as { readonly id: string; readonly sourcePath: string };
    assert.equal(job.sourcePath, rel);
    await tools.encoderStarted;
    await assert.rejects(renameEpisode(), (error: unknown) => (error as { status: number }).status === 423);
    tools.releaseEncoder();
    await waitForWriterOutcome(() => database.query<{ readonly status: string }, [string]>("SELECT status FROM transcode_jobs WHERE id = ?").get(job.id)?.status === "complete");
    await renameEpisode();
    const remapped = database.query<{ readonly source_rel: string }, [string]>("SELECT source_rel FROM transcode_jobs WHERE id = ?").get(job.id);
    assert.equal(remapped?.source_rel, "Show/renamed.mkv");
  } finally { tools.close(); }
}
