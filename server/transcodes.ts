import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import type { TranscodePreset } from "../shared/types.ts";
import { database } from "./database.ts";
import { claimTranscodeWorkerPaths, LibraryFileError, libraryWriterResponse, resolveExisting } from "./libraryWriterAdmission.ts";
import { detachTorrentsForFiles } from "./torrents.ts";
import { captureEncoder, captureProbe, readTranscodeProgress } from "./transcodeProgress.ts";
import type { MediaLibraryOptions } from "./mediaLibraryOptions.ts";
import { budget, encoderCommandPrefix, presetArgs, reapStrayEncodersOnce, reservedCpus, stopEncoder } from "./transcodeEncoder.ts";

type TranscodeStatus = "cancelled" | "complete" | "failed" | "processing" | "queued";

interface TranscodeRow {
  readonly id: string;
  readonly source_rel: string;
  readonly preset: TranscodePreset;
  readonly output_rel: string;
  readonly status: TranscodeStatus;
  readonly input_size: number;
  readonly output_size: number | null;
  readonly progress: number;
  readonly speed: number;
  readonly started_at: number | null;
  readonly error: string | null;
  readonly original_deleted: number;
  readonly created_at: number;
  readonly updated_at: number;
}

interface StartBody {
  readonly path?: unknown;
  readonly paths?: unknown;
  readonly preset?: unknown;
}

const jobs = database.query<TranscodeRow, []>(`
  SELECT * FROM transcode_jobs ORDER BY created_at DESC
`);
const insertJob = database.query<void, [string, string, string, string, number, number, number]>(`
  INSERT INTO transcode_jobs
    (id, source_rel, preset, output_rel, status, input_size, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
`);
const updateJob = database.query<void, [string, number | null, string | null, number, string]>(`
  UPDATE transcode_jobs SET status = ?, output_size = ?, error = ?, updated_at = ? WHERE id = ?
`);
const startJob = database.query<void, [number, string]>(`
  UPDATE transcode_jobs
  SET status = 'processing', progress = 0, speed = 0, started_at = ?, error = NULL
  WHERE id = ?
`);
const updateProgress = database.query<void, [number, number, number, string]>(`
  UPDATE transcode_jobs SET progress = ?, speed = ?, updated_at = ? WHERE id = ?
`);
const jobById = database.query<TranscodeRow, [string]>("SELECT * FROM transcode_jobs WHERE id = ?");
const deleteJob = database.query<void, [string]>("DELETE FROM transcode_jobs WHERE id = ?");
const promoteJob = database.query<void, [string, number, string]>(`
  UPDATE transcode_jobs SET output_rel = ?, original_deleted = 1, status = 'complete', updated_at = ?
  WHERE id = ?
`);
database.run(`
  UPDATE transcode_jobs SET status = 'queued', progress = 0, speed = 0, started_at = NULL
  WHERE status = 'processing'
`);

const maxWorkers = budget.workers;
const encoderPrefix = encoderCommandPrefix(await reservedCpus(budget.cpus));
const activeJobs = new Set<string>();
const editingJobs = new Set<string>();
const cancelledJobs = new Set<string>();
const activeProcesses = new Map<string, Bun.Subprocess<"ignore", "pipe", "pipe">>();
const OUTPUT_NAME = /^(?<key>[a-f0-9]{24})-(?<id>[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.mkv$/u;

const latestJobForSource = database.query<TranscodeRow, [string]>(`
  SELECT * FROM transcode_jobs WHERE source_rel = ? ORDER BY created_at DESC LIMIT 1
`);

export interface SourceTranscodeState {
  readonly status: TranscodeStatus;
  readonly progress: number;
}

/** The newest stored-transcode job for a library video, if any. */
export function sourceTranscodeState(rel: string): SourceTranscodeState | null {
  const row = latestJobForSource.get(rel);
  return row === null ? null : { status: row.status, progress: row.progress };
}

/** A finished compatibility copy that still sits beside its original. */
export function storedCompatibilityCopy(rel: string, options: MediaLibraryOptions): Promise<string | null> {
  const row = latestJobForSource.get(rel);
  if (row?.status !== "complete" || row.preset !== "compatibility" || row.original_deleted === 1) {
    return Promise.resolve(null);
  }
  return existingOutputPath(row, options);
}

function publicJob(row: TranscodeRow) {
  return {
    id: row.id,
    sourcePath: row.source_rel,
    preset: row.preset,
    status: row.status,
    inputSize: row.input_size,
    outputSize: row.output_size,
    progress: row.progress,
    speed: row.speed,
    startedAt: row.started_at,
    error: row.error,
    originalDeleted: row.original_deleted === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function transcodePreset(value: string): TranscodePreset | null {
  return value === "space-saver" || value === "compatibility" ? value : null;
}

async function outputDirectory(options: MediaLibraryOptions): Promise<string | null> {
  const directory = resolve(options.mediaRoot, ".nanime-transcodes");
  await mkdir(directory, { recursive: true, mode: 0o700 }).catch(() => undefined);
  const canonical = await realpath(directory).catch(() => null);
  return canonical !== null && canonical.startsWith(options.mediaRoot + sep) ? canonical : null;
}

async function pendingOutputPath(row: TranscodeRow, options: MediaLibraryOptions): Promise<string | null> {
  const name = row.output_rel.startsWith(".nanime-transcodes/")
    ? row.output_rel.slice(".nanime-transcodes/".length)
    : "";
  if (!OUTPUT_NAME.test(name)) {
    return null;
  }
  const directory = await outputDirectory(options);
  return directory === null ? null : join(directory, name);
}

async function existingOutputPath(row: TranscodeRow, options: MediaLibraryOptions): Promise<string | null> {
  const pending = await pendingOutputPath(row, options);
  const canonical = pending === null ? null : await realpath(pending).catch(() => null);
  return canonical !== null && canonical.startsWith(options.mediaRoot + sep) ? canonical : null;
}

async function duration(path: string): Promise<number> {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { stdout: "pipe", stderr: "ignore" });
  const { code, text } = await captureProbe(proc, new Response(proc.stdout).text());
  const value = Number(text.trim());
  return code === 0 && Number.isFinite(value) ? value : 0;
}

async function jobPaths(row: TranscodeRow, options: MediaLibraryOptions) {
  const [source, output] = await Promise.all([
    safeSource(row.source_rel, options),
    pendingOutputPath(row, options),
  ]);
  const preset = transcodePreset(row.preset);
  if (source === null || output === null || preset === null) {
    throw new Error("Transcode job contains an invalid media path or preset");
  }
  return { source, output, preset };
}

async function processJob(row: TranscodeRow, options: MediaLibraryOptions): Promise<void> {
  const { source, output, preset } = await jobPaths(row, options);
  if (cancelledJobs.has(row.id)) { return; }
  const startedAt = Date.now();
  startJob.run(startedAt, row.id);
  const sourceDuration = await duration(source);
  if (cancelledJobs.has(row.id)) {
    return;
  }
  const threads = String(budget.threadsPerWorker);
  const proc = Bun.spawn([
    ...encoderPrefix,
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1",
    "-nostats", "-y", "-threads", threads, "-filter_threads", threads, "-i", source,
    "-map", "0:v:0", "-map", "0:a?", "-map", "0:s?", "-map", "0:t?",
    "-map_metadata", "0", "-c:s", "copy", "-c:t", "copy",
    ...presetArgs(preset), output,
  ], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  activeProcesses.set(row.id, proc);
  const stderr = new Response(proc.stderr).text();
  const progress = readTranscodeProgress(proc.stdout, sourceDuration, (sample) => {
    updateProgress.run(sample.progress, sample.speed, Date.now(), row.id);
  });
  const { code: exitCode, stderr: stderrText } = await captureEncoder(proc, { stderr, progress });
  const errorText = stderrText.trim();
  activeProcesses.delete(row.id);
  if (cancelledJobs.has(row.id)) { return; }
  const [outputStat, outputDuration] = await Promise.all([
    lstat(output).catch(() => null),
    duration(output),
  ]);
  if (cancelledJobs.has(row.id)) { return; }
  const valid = exitCode === 0 && outputStat?.isFile() === true && outputStat.size > 0 &&
    sourceDuration > 0 && Math.abs(sourceDuration - outputDuration) <= 2;
  if (valid) {
    updateProgress.run(1, 0, Date.now(), row.id);
    updateJob.run("complete", outputStat.size, null, Date.now(), row.id);
  } else {
    await unlink(output).catch(() => undefined);
    if (!cancelledJobs.has(row.id)) {
      updateJob.run("failed", null, errorText.slice(-500) || "Output validation failed", Date.now(), row.id);
    }
  }
}

async function cleanupCancelledJob(row: TranscodeRow, options: MediaLibraryOptions): Promise<void> {
  if (!cancelledJobs.has(row.id)) { return; }
  const output = await pendingOutputPath(row, options);
  if (output !== null) { await unlink(output).catch(() => undefined); }
  updateJob.run("cancelled", null, null, Date.now(), row.id);
}

async function executeJob(row: TranscodeRow, options: MediaLibraryOptions, release: () => void): Promise<void> {
  try {
    await processJob(row, options);
  } catch (error) {
    const output = await pendingOutputPath(row, options);
    if (output !== null) { await unlink(output).catch(() => undefined); }
    if (!cancelledJobs.has(row.id)) {
      const message = error instanceof Error ? error.message : "Transcode process could not start";
      updateJob.run("failed", null, message.slice(0, 500), Date.now(), row.id);
    }
  } finally {
    try {
      await cleanupCancelledJob(row, options);
    } finally {
      activeProcesses.delete(row.id);
      activeJobs.delete(row.id);
      cancelledJobs.delete(row.id);
      release();
      runQueue(options);
    }
  }
}

function runQueue(options: MediaLibraryOptions): void {
  void (async (): Promise<void> => {
    // Before this server's first worker starts, stop encoders a previous instance left behind.
    await reapStrayEncodersOnce(resolve(options.mediaRoot, ".nanime-transcodes"));
    startQueuedJobs(options);
  })();
}

/** Resume queued work after a restart instead of waiting for an admin request. */
export function resumeTranscodeQueue(options: MediaLibraryOptions): void {
  runQueue(options);
}

function startQueuedJobs(options: MediaLibraryOptions): void {
  const queued = jobs.all().toReversed().filter((row) => (
    row.status === "queued" && !activeJobs.has(row.id) && !editingJobs.has(row.id)
  ));
  for (const row of queued) {
    if (activeJobs.size >= maxWorkers) { break; }
    let release: (() => void) | null = null;
    try {
      release = claimTranscodeWorkerPaths([row.source_rel]);
    } catch (error) {
      if (!(error instanceof LibraryFileError)) { throw error; }
      if (error.status !== 423) { updateJob.run("failed", null, error.message, Date.now(), row.id); }
      continue;
    }
    activeJobs.add(row.id);
    void executeJob(row, options, release);
  }
}

async function safeSource(path: string, options: MediaLibraryOptions): Promise<string | null> {
  try {
    const source = await resolveExisting(options.mediaRoot, path);
    return source.abs;
  } catch {
    return null;
  }
}

async function start(req: Request, options: MediaLibraryOptions): Promise<Response> {
  const body = (await req.json().catch(() => null)) as StartBody | null;
  const path = body?.path;
  const preset = body?.preset;
  if (typeof path !== "string" || (preset !== "space-saver" && preset !== "compatibility")) {
    return new Response("Choose a video and preset", { status: 400 });
  }
  const response = await libraryWriterResponse({ root: options.mediaRoot, paths: [path], allowJobs: true }, () => (
    startClaimed(path, preset, options)
  ));
  runQueue(options);
  return response;
}

async function startClaimed(path: string, preset: TranscodePreset, options: MediaLibraryOptions): Promise<Response> {
  const source = await safeSource(path, options);
  if (source === null) {
    return new Response("Video not found", { status: 404 });
  }
  const sourceStat = await lstat(source).catch(() => null);
  if (sourceStat?.isFile() !== true || !options.videoExtensions.has(extname(source).toLowerCase())) {
    return new Response("Video not found", { status: 404 });
  }
  const duplicate = jobs.all().some((row) => row.source_rel === path && row.status !== "failed");
  if (duplicate) {
    return new Response("This video already has a transcode job", { status: 409 });
  }
  const id = randomUUID();
  const extension = ".mkv";
  const key = createHash("sha256").update(path).digest("hex").slice(0, 24);
  const outputRel = `.nanime-transcodes/${key}-${id}${extension}`;
  const now = Date.now();
  insertJob.run(id, path, preset, outputRel, sourceStat.size, now, now);
  return Response.json(publicJob(jobById.get(id) as TranscodeRow), { status: 201 });
}

async function startBulk(req: Request, options: MediaLibraryOptions): Promise<Response> {
  const body = (await req.json().catch(() => null)) as StartBody | null;
  const paths = body?.paths;
  const preset = body?.preset;
  if (
    !Array.isArray(paths) || paths.length === 0 || paths.length > 500 ||
    !paths.every((path) => typeof path === "string") ||
    (preset !== "space-saver" && preset !== "compatibility")
  ) {
    return new Response("Choose up to 500 videos and a preset", { status: 400 });
  }
  const uniquePaths = [...new Set(paths as string[])];
  const response = await libraryWriterResponse({ root: options.mediaRoot, paths: uniquePaths, allowJobs: true }, () => (
    startBulkClaimed(uniquePaths, preset, options)
  ));
  runQueue(options);
  return response;
}

async function startBulkClaimed(uniquePaths: readonly string[], preset: TranscodePreset, options: MediaLibraryOptions): Promise<Response> {
  const sources = await Promise.all(uniquePaths.map(async (path) => {
    const source = await safeSource(path, options);
    const sourceStat = source === null ? null : await lstat(source).catch(() => null);
    return source !== null && sourceStat?.isFile() === true &&
      options.videoExtensions.has(extname(source).toLowerCase())
      ? { path, size: sourceStat.size }
      : null;
  }));
  if (sources.some((source) => source === null)) {
    return new Response("One or more videos no longer exist", { status: 404 });
  }
  const existing = new Set(jobs.all().flatMap((row) => (
    row.status === "failed" || row.status === "cancelled" ? [] : [row.source_rel]
  )));
  const queued = (sources as { readonly path: string; readonly size: number }[])
    .flatMap((source) => {
      if (existing.has(source.path)) {
        return [];
      }
      const id = randomUUID();
      const key = createHash("sha256").update(source.path).digest("hex").slice(0, 24);
      const outputRel = `.nanime-transcodes/${key}-${id}.mkv`;
      const now = Date.now();
      insertJob.run(id, source.path, preset, outputRel, source.size, now, now);
      return [jobById.get(id) as TranscodeRow];
    });
  if (queued.length === 0) {
    return new Response("Every video in this season already has a transcode job", { status: 409 });
  }
  return Response.json(queued.map((row) => publicJob(row)), { status: 201 });
}

function cancel(row: TranscodeRow, options: MediaLibraryOptions): Response | Promise<Response> {
  if (editingJobs.has(row.id)) { return new Response("This job is already being modified", { status: 409 }); }
  if (row.status !== "queued" && row.status !== "processing") {
    return new Response("Only queued or processing jobs can be cancelled", { status: 409 });
  }
  if (activeJobs.has(row.id)) {
    updateJob.run("cancelled", null, null, Date.now(), row.id);
    cancelledJobs.add(row.id);
    stopEncoder(activeProcesses.get(row.id));
    return Response.json(publicJob(jobById.get(row.id) as TranscodeRow));
  }
  return editJob(row.id, options, async () => {
    updateJob.run("cancelled", null, null, Date.now(), row.id);
    const output = await existingOutputPath(row, options);
    if (output !== null) { await unlink(output).catch(() => undefined); }
    return Response.json(publicJob(jobById.get(row.id) as TranscodeRow));
  });
}

/** Reserve a per-job lifecycle turn synchronously before filesystem awaits. */
async function editJob(id: string, options: MediaLibraryOptions, work: () => Promise<Response>): Promise<Response> {
  if (editingJobs.has(id) || activeJobs.has(id)) {
    return new Response("An active or changing job cannot be modified yet", { status: 409 });
  }
  editingJobs.add(id);
  try { return await work(); }
  finally { editingJobs.delete(id); runQueue(options); }
}

function removeOriginal(row: TranscodeRow, options: MediaLibraryOptions): Response | Promise<Response> {
  if (row.status !== "complete" || row.original_deleted === 1) {
    return new Response("Original cannot be deleted", { status: 409 });
  }
  return editJob(row.id, options, () => libraryWriterResponse({ root: options.mediaRoot, paths: [row.source_rel], siblings: true }, () => (
    promoteClaimedOriginal(row, options)
  )));
}

async function promoteClaimedOriginal(row: TranscodeRow, options: MediaLibraryOptions): Promise<Response> {
  const [source, output] = await Promise.all([
    safeSource(row.source_rel, options),
    existingOutputPath(row, options),
  ]);
  const preset = transcodePreset(row.preset);
  if (source === null || output === null || preset === null) {
    return new Response("Media not found", { status: 404 });
  }
  if (!(await detachTorrentsForFiles([source]))) {
    return new Response("Could not safely detach the torrent", { status: 502 });
  }
  const extension = extname(output);
  const target = join(dirname(source), `${basename(source, extname(source))}.${preset}${extension}`);
  const targetRel = relative(options.mediaRoot, target).split(sep).join("/");
  if (await lstat(target).catch(() => null) !== null) {
    return new Response("Optimized destination already exists", { status: 409 });
  }
  await rename(output, target);
  try {
    await unlink(source);
  } catch (error) {
    await rename(target, output).catch(() => undefined);
    throw error;
  }
  promoteJob.run(targetRel, Date.now(), row.id);
  return Response.json(publicJob(jobById.get(row.id) as TranscodeRow));
}

function deleteTranscode(row: TranscodeRow, options: MediaLibraryOptions): Response | Promise<Response> {
  if (row.original_deleted === 1) {
    return new Response("The optimized copy is now the library copy", { status: 409 });
  }
  if (row.status === "processing" || activeJobs.has(row.id)) {
    return new Response("An active worker cannot be removed until it finishes cleanup", { status: 409 });
  }
  return editJob(row.id, options, async () => {
    const output = await existingOutputPath(row, options);
    if (output !== null) {
      await unlink(output).catch(() => undefined);
    }
    deleteJob.run(row.id);
    return new Response(null, { status: 204 });
  });
}

function transcodeJobResponse(
  req: Request,
  pathname: string,
  options: MediaLibraryOptions,
): Response | Promise<Response> {
  const match = /^\/api\/transcodes\/(?<id>[0-9a-f-]+)(?<action>\/(?:original|cancel))?$/u.exec(pathname);
  const id = match?.groups?.["id"];
  const row = id === undefined ? null : jobById.get(id);
  if (row === null) {
    return new Response("Transcode job not found", { status: 404 });
  }
  const action = match?.groups?.["action"];
  if (action === "/original" && req.method === "DELETE") {
    return removeOriginal(row, options);
  }
  if (action === "/cancel" && req.method === "POST") {
    return cancel(row, options);
  }
  return action === undefined && req.method === "DELETE"
    ? deleteTranscode(row, options)
    : new Response("Method not allowed", { status: 405 });
}

export function transcodeResponse(
  req: Request,
  pathname: string,
  options: MediaLibraryOptions,
): Response | Promise<Response> {
  void runQueue(options);
  if (pathname === "/api/transcodes" && req.method === "GET") {
    return Response.json(jobs.all().map((row) => publicJob(row)));
  }
  if (pathname === "/api/transcodes" && req.method === "POST") {
    return start(req, options);
  }
  if (pathname === "/api/transcodes/bulk" && req.method === "POST") {
    return startBulk(req, options);
  }
  return transcodeJobResponse(req, pathname, options);
}
