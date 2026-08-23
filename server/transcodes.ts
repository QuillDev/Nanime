import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { availableParallelism, totalmem } from "node:os";
import { database } from "./database.ts";
import { detachTorrentsForFiles } from "./torrents.ts";
import { readTranscodeProgress } from "./transcodeProgress.ts";

type TranscodePreset = "space-saver" | "compatibility";

interface TranscodeRow {
  readonly id: string;
  readonly source_rel: string;
  readonly preset: string;
  readonly output_rel: string;
  readonly status: string;
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

interface TranscodeOptions {
  readonly mediaDir: string;
  readonly mediaRoot: string;
  readonly videoExtensions: ReadonlySet<string>;
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

const configuredWorkers = Number(process.env["NANIME_TRANSCODE_WORKERS"] ?? "");
const automaticWorkers = availableParallelism() >= 24 && totalmem() >= 24 * 1024 ** 3 ? 2 : 1;
const maxWorkers = Number.isInteger(configuredWorkers) && configuredWorkers > 0
  ? Math.min(configuredWorkers, 4)
  : automaticWorkers;
const activeJobs = new Set<string>();
const cancelledJobs = new Set<string>();
const activeProcesses = new Map<string, { kill: () => void }>();
const OUTPUT_NAME = /^(?<key>[a-f0-9]{24})-(?<id>[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.mkv$/u;

function publicJob(row: TranscodeRow): object {
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

function presetArgs(preset: TranscodePreset): readonly string[] {
  return preset === "space-saver"
    ? ["-c:v", "libsvtav1", "-preset", "5", "-crf", "30", "-pix_fmt", "yuv420p10le", "-c:a", "libopus", "-b:a", "128k"]
    : ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k"];
}

function transcodePreset(value: string): TranscodePreset | null {
  return value === "space-saver" || value === "compatibility" ? value : null;
}

async function outputDirectory(options: TranscodeOptions): Promise<string | null> {
  const directory = resolve(options.mediaRoot, ".nanime-transcodes");
  await mkdir(directory, { recursive: true, mode: 0o700 }).catch(() => undefined);
  const canonical = await realpath(directory).catch(() => null);
  return canonical !== null && canonical.startsWith(options.mediaRoot + sep) ? canonical : null;
}

async function pendingOutputPath(row: TranscodeRow, options: TranscodeOptions): Promise<string | null> {
  const name = row.output_rel.startsWith(".nanime-transcodes/")
    ? row.output_rel.slice(".nanime-transcodes/".length)
    : "";
  if (!OUTPUT_NAME.test(name)) {return null;}
  const directory = await outputDirectory(options);
  return directory === null ? null : join(directory, name);
}

async function existingOutputPath(row: TranscodeRow, options: TranscodeOptions): Promise<string | null> {
  const pending = await pendingOutputPath(row, options);
  const canonical = pending === null ? null : await realpath(pending).catch(() => null);
  return canonical !== null && canonical.startsWith(options.mediaRoot + sep) ? canonical : null;
}

async function duration(path: string): Promise<number> {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(proc.stdout).text();
  const value = Number(text.trim());
  return await proc.exited === 0 && Number.isFinite(value) ? value : 0;
}

async function processJob(row: TranscodeRow, options: TranscodeOptions): Promise<void> {
  const [source, output] = await Promise.all([
    safeSource(row.source_rel, options),
    pendingOutputPath(row, options),
  ]);
  const preset = transcodePreset(row.preset);
  if (source === null || output === null || preset === null) {
    throw new Error("Transcode job contains an invalid media path or preset");
  }
  const startedAt = Date.now();
  startJob.run(startedAt, row.id);
  const sourceDuration = await duration(source);
  if (cancelledJobs.has(row.id)) {
    cancelledJobs.delete(row.id);
    updateJob.run("cancelled", null, null, Date.now(), row.id);
    return;
  }
  const proc = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1",
    "-nostats", "-y", "-i", source,
    "-map", "0:v:0", "-map", "0:a?", "-map", "0:s?", "-map", "0:t?",
    "-map_metadata", "0", "-c:s", "copy", "-c:t", "copy",
    ...presetArgs(preset), output,
  ], { stdout: "pipe", stderr: "pipe" });
  activeProcesses.set(row.id, proc);
  const stderr = new Response(proc.stderr).text();
  const progress = readTranscodeProgress(proc.stdout, sourceDuration, (sample) => {
    updateProgress.run(sample.progress, sample.speed, Date.now(), row.id);
  });
  const [exitCode, stderrText] = await Promise.all([proc.exited, stderr, progress]) as [number, string, void];
  const errorText = stderrText.trim();
  activeProcesses.delete(row.id);
  if (cancelledJobs.has(row.id)) {
    cancelledJobs.delete(row.id);
    await unlink(output).catch(() => undefined);
    updateJob.run("cancelled", null, null, Date.now(), row.id);
    return;
  }
  const [outputStat, outputDuration] = await Promise.all([
    lstat(output).catch(() => null),
    duration(output),
  ]);
  const valid = exitCode === 0 && outputStat?.isFile() === true && outputStat.size > 0 &&
    sourceDuration > 0 && Math.abs(sourceDuration - outputDuration) <= 2;
  if (valid) {
    updateProgress.run(1, 0, Date.now(), row.id);
    updateJob.run("complete", outputStat.size, null, Date.now(), row.id);
  } else {
    await unlink(output).catch(() => undefined);
    updateJob.run("failed", null, errorText.slice(-500) || "Output validation failed", Date.now(), row.id);
  }
}

async function executeJob(row: TranscodeRow, options: TranscodeOptions): Promise<void> {
  try {
    await processJob(row, options);
  } catch (error) {
    if (cancelledJobs.delete(row.id)) {
      const output = await pendingOutputPath(row, options);
      if (output !== null) {await unlink(output).catch(() => undefined);}
      updateJob.run("cancelled", null, null, Date.now(), row.id);
    } else {
      const message = error instanceof Error ? error.message : "Transcode process could not start";
      updateJob.run("failed", null, message.slice(0, 500), Date.now(), row.id);
    }
  } finally {
    activeProcesses.delete(row.id);
    activeJobs.delete(row.id);
    void runQueue(options);
  }
}

function runQueue(options: TranscodeOptions): void {
  const queued = jobs.all().toReversed().filter((row) => (
    row.status === "queued" && !activeJobs.has(row.id)
  ));
  for (const row of queued.slice(0, maxWorkers - activeJobs.size)) {
    activeJobs.add(row.id);
    void executeJob(row, options);
  }
}

async function safeSource(path: string, options: TranscodeOptions): Promise<string | null> {
  const absolute = resolve(options.mediaDir, path);
  if (absolute === options.mediaDir || !absolute.startsWith(options.mediaDir + sep)) {return null;}
  const canonical = await realpath(absolute).catch(() => null);
  return canonical !== null && canonical.startsWith(options.mediaRoot + sep) ? canonical : null;
}

async function start(req: Request, options: TranscodeOptions): Promise<Response> {
  const body = (await req.json().catch(() => null)) as StartBody | null;
  const path = body?.path;
  const preset = body?.preset;
  if (typeof path !== "string" || (preset !== "space-saver" && preset !== "compatibility")) {
    return new Response("Choose a video and preset", { status: 400 });
  }
  const source = await safeSource(path, options);
  if (source === null) {
    return new Response("Video not found", { status: 404 });
  }
  const sourceStat = await lstat(source).catch(() => null);
  if (sourceStat?.isFile() !== true || !options.videoExtensions.has(extname(source).toLowerCase())) {
    return new Response("Video not found", { status: 404 });
  }
  const duplicate = jobs.all().some((row) => row.source_rel === path && row.status !== "failed");
  if (duplicate) {return new Response("This video already has a transcode job", { status: 409 });}
  const id = randomUUID();
  const extension = ".mkv";
  const key = createHash("sha256").update(path).digest("hex").slice(0, 24);
  const outputRel = `.nanime-transcodes/${key}-${id}${extension}`;
  const now = Date.now();
  insertJob.run(id, path, preset, outputRel, sourceStat.size, now, now);
  void runQueue(options);
  return Response.json(publicJob(jobById.get(id) as TranscodeRow), { status: 201 });
}

async function startBulk(req: Request, options: TranscodeOptions): Promise<Response> {
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
  void runQueue(options);
  return Response.json(queued.map((row) => publicJob(row)), { status: 201 });
}

async function cancel(row: TranscodeRow, options: TranscodeOptions): Promise<Response> {
  if (row.status !== "queued" && row.status !== "processing") {
    return new Response("Only queued or processing jobs can be cancelled", { status: 409 });
  }
  cancelledJobs.add(row.id);
  activeProcesses.get(row.id)?.kill();
  if (row.status === "queued") {
    cancelledJobs.delete(row.id);
    const output = await pendingOutputPath(row, options);
    if (output !== null) {await unlink(output).catch(() => undefined);}
  }
  updateJob.run("cancelled", null, null, Date.now(), row.id);
  return Response.json(publicJob(jobById.get(row.id) as TranscodeRow));
}

async function removeOriginal(row: TranscodeRow, options: TranscodeOptions): Promise<Response> {
  if (row.status !== "complete" || row.original_deleted === 1) {return new Response("Original cannot be deleted", { status: 409 });}
  const [source, output] = await Promise.all([
    safeSource(row.source_rel, options),
    existingOutputPath(row, options),
  ]);
  const preset = transcodePreset(row.preset);
  if (source === null || output === null || preset === null) {return new Response("Media not found", { status: 404 });}
  if (!(await detachTorrentsForFiles([source]))) {return new Response("Could not safely detach the torrent", { status: 502 });}
  const extension = extname(output);
  const target = join(dirname(source), `${basename(source, extname(source))}.${preset}${extension}`);
  const targetRel = relative(options.mediaDir, target);
  if (await lstat(target).catch(() => null) !== null) {return new Response("Optimized destination already exists", { status: 409 });}
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

export async function transcodeResponse(req: Request, pathname: string, options: TranscodeOptions): Promise<Response> {
  void runQueue(options);
  if (pathname === "/api/transcodes" && req.method === "GET") {return Response.json(jobs.all().map((row) => publicJob(row)));}
  if (pathname === "/api/transcodes" && req.method === "POST") {return start(req, options);}
  if (pathname === "/api/transcodes/bulk" && req.method === "POST") {return startBulk(req, options);}
  const match = /^\/api\/transcodes\/(?<id>[0-9a-f-]+)(?<action>\/(?:original|cancel))?$/u.exec(pathname);
  const id = match?.groups?.["id"];
  const row = id === undefined ? null : jobById.get(id);
  if (row === null) {return new Response("Transcode job not found", { status: 404 });}
  if (match?.groups?.["action"] === "/original" && req.method === "DELETE") {return removeOriginal(row, options);}
  if (match?.groups?.["action"] === "/cancel" && req.method === "POST") {return cancel(row, options);}
  if (match?.groups?.["action"] === undefined && req.method === "DELETE") {
    if (row.original_deleted === 1) {return new Response("The optimized copy is now the library copy", { status: 409 });}
    if (row.status === "processing") {return new Response("A processing job cannot be removed", { status: 409 });}
    const output = await existingOutputPath(row, options);
    if (output !== null) {await unlink(output).catch(() => undefined);}
    deleteJob.run(row.id);
    return new Response(null, { status: 204 });
  }
  return new Response("Method not allowed", { status: 405 });
}
