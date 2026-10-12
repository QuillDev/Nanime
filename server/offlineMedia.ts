import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, realpath, rename, unlink } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { libraryWriterResponse, revalidateWriterSource, type WriterSource } from "./libraryWriterAdmission.ts";
import type { OfflineMediaArtifact } from "../shared/types.ts";
import { database } from "./database.ts";
import { jsonObject } from "./json.ts";
import { probeDuration, selectedAudioIndex } from "./offlineMediaInspection.ts";
import { readTranscodeProgress } from "./transcodeProgress.ts";
import { rangedFileResponse } from "./httpRange.ts";

// Nanime's own folders, like the media library scan skips them. Trashed media
// keeps its artifact rows so Undo restores them, but is never served.
const INTERNAL_SEGMENT = /(?:^|[\\/])\.nanime-/iu;

type ArtifactStatus = "failed" | "preparing" | "queued" | "ready";

interface ArtifactRow {
  readonly id: string;
  readonly source_rel: string;
  readonly source_size: number;
  readonly source_modified_at: number;
  readonly audio_index: number;
  readonly direct: number;
  readonly output_name: string | null;
  readonly status: ArtifactStatus;
  readonly progress: number;
  readonly speed: number;
  readonly duration: number;
  readonly size_bytes: number | null;
  readonly mime_type: string;
  readonly error: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface OfflineMediaOptions {
  readonly mediaDir: string;
  readonly mediaRoot: string;
  readonly videoExtensions: ReadonlySet<string>;
  readonly directPlayExtensions: ReadonlySet<string>;
  readonly preferredAudioLanguage?: string | null;
}

interface Source {
  readonly abs: string;
  readonly rel: string;
  readonly size: number;
  readonly modifiedAt: number;
  readonly direct: boolean;
}

interface SourceResolution {
  readonly error: string | null;
  readonly source: Source | null;
}

const artifacts = database.query<ArtifactRow, []>(`
  SELECT * FROM offline_media_artifacts ORDER BY created_at
`);
const artifactById = database.query<ArtifactRow, [string]>(`
  SELECT * FROM offline_media_artifacts WHERE id = ?
`);
const matchingArtifact = database.query<ArtifactRow, [string, number, number, number, number]>(`
  SELECT * FROM offline_media_artifacts
  WHERE source_rel = ? AND source_size = ? AND source_modified_at = ? AND audio_index = ?
    AND direct = ?
`);
const insertArtifact = database.query<void, [
  string, string, number, number, number, number, string | null, string, number,
  number | null, string, number, number,
]>(`
  INSERT INTO offline_media_artifacts
    (id, source_rel, source_size, source_modified_at, audio_index, direct,
     output_name, status, duration, size_bytes, mime_type, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const startArtifact = database.query<void, [number, string]>(`
  UPDATE offline_media_artifacts
  SET status = 'preparing', progress = 0, speed = 0, error = NULL, updated_at = ?
  WHERE id = ?
`);
const updateProgress = database.query<void, [number, number, number, string]>(`
  UPDATE offline_media_artifacts SET progress = ?, speed = ?, updated_at = ? WHERE id = ?
`);
const finishArtifact = database.query<void, [number, number, number, string]>(`
  UPDATE offline_media_artifacts
  SET status = 'ready', progress = 1, speed = 0, size_bytes = ?, duration = ?, updated_at = ?
  WHERE id = ?
`);
const failArtifact = database.query<void, [string, number, string]>(`
  UPDATE offline_media_artifacts
  SET status = 'failed', progress = 0, speed = 0, error = ?, updated_at = ? WHERE id = ?
`);
const requeueArtifact = database.query<void, [number, string]>(`
  UPDATE offline_media_artifacts
  SET status = 'queued', progress = 0, speed = 0, size_bytes = NULL, error = NULL, updated_at = ?
  WHERE id = ?
`);
const restoreDirectArtifact = database.query<void, [number, string]>(`
  UPDATE offline_media_artifacts
  SET status = 'ready', progress = 1, speed = 0, size_bytes = source_size,
      error = NULL, updated_at = ?
  WHERE id = ? AND direct = 1
`);

const activeArtifacts = new Set<string>();
const MAX_WORKERS = 1;
const OUTPUT_NAME = /^[0-9a-f-]+\.mp4$/u;
const MIME_TYPES = new Map(Object.entries({
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".ogv": "video/ogg",
  ".webm": "video/webm",
} as const));

function publicArtifact(row: ArtifactRow): OfflineMediaArtifact {
  return {
    id: row.id,
    path: row.source_rel,
    status: row.status,
    progress: row.progress,
    speed: row.speed,
    sourceSizeBytes: row.source_size,
    sizeBytes: row.size_bytes,
    duration: row.duration,
    mimeType: row.mime_type,
    mediaUrl: row.status === "ready" ? `/offline-media/${row.id}/media` : null,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function artifactResponse(row: ArtifactRow, status = 200): Response {
  return Response.json(publicArtifact(row), {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function resolveSource(rel: string, options: OfflineMediaOptions): Promise<SourceResolution> {
  if (INTERNAL_SEGMENT.test(rel)) {
    return { error: "Video file is no longer available", source: null };
  }
  const candidate = resolve(options.mediaDir, rel);
  if (candidate === options.mediaDir || !candidate.startsWith(options.mediaDir + sep)) {
    return { error: "Video path is invalid", source: null };
  }
  const abs = await realpath(candidate).catch(() => null);
  if (abs === null) {
    return { error: "Video file is no longer available", source: null };
  }
  if (!abs.startsWith(options.mediaRoot + sep)) {
    return { error: "Video path is outside the media library", source: null };
  }
  const canonicalRel = relative(options.mediaRoot, abs).split(sep).join("/");
  if (INTERNAL_SEGMENT.test(canonicalRel)) {
    return { error: "Video file is no longer available", source: null };
  }
  const extension = extname(abs).toLowerCase();
  if (!options.videoExtensions.has(extension)) {
    return { error: "Video format is not supported for offline playback", source: null };
  }
  const information = await lstat(abs).catch(() => null);
  if (information?.isFile() !== true) {
    return { error: "Video file is no longer available", source: null };
  }
  return {
    error: null,
    source: {
      abs,
      rel: canonicalRel,
      size: information.size,
      modifiedAt: information.mtimeMs,
      direct: options.directPlayExtensions.has(extension),
    },
  };
}

async function sourceFor(rel: string, options: OfflineMediaOptions): Promise<Source | null> {
  const resolution = await resolveSource(rel, options);
  return resolution.source;
}

export function offlineTranscodeArgs(
  abs: string,
  audioIndex: number | null,
  output: string,
): readonly string[] {
  const audioMap = audioIndex === null ? [] : ["-map", `0:${String(audioIndex)}`];
  const audioCodec = audioIndex === null ? [] : ["-c:a", "aac", "-ac", "2", "-b:a", "160k"];
  return [
    "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats", "-y",
    "-i", abs,
    "-map", "0:v:0", ...audioMap,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    ...audioCodec,
    "-sn", "-dn", "-movflags", "+faststart", output,
  ];
}

async function artifactDirectory(options: OfflineMediaOptions): Promise<string> {
  const directory = resolve(options.mediaRoot, ".nanime-offline");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const canonical = await realpath(directory);
  if (!canonical.startsWith(options.mediaRoot + sep)) {
    throw new Error("Offline media directory is outside the media library");
  }
  return canonical;
}

async function artifactOutput(row: ArtifactRow, options: OfflineMediaOptions): Promise<string | null> {
  if (row.output_name === null || !OUTPUT_NAME.test(row.output_name)) {
    return null;
  }
  return join(await artifactDirectory(options), row.output_name);
}

async function validOutput(path: string, sourceDuration: number): Promise<{ size: number; duration: number } | null> {
  const [information, duration] = await Promise.all([
    lstat(path).catch(() => null),
    probeDuration(path),
  ]);
  const validDuration = sourceDuration <= 0 || duration > 0 && Math.abs(duration - sourceDuration) <= 2;
  return information?.isFile() === true && information.size > 0 && validDuration
    ? { size: information.size, duration }
    : null;
}

async function transcodeArtifact(row: ArtifactRow, options: OfflineMediaOptions): Promise<void> {
  const [source, output] = await Promise.all([
    sourceFor(row.source_rel, options),
    artifactOutput(row, options),
  ]);
  if (
    source === null || output === null || source.size !== row.source_size ||
    source.modifiedAt !== row.source_modified_at
  ) {
    throw new Error("Source media changed before preparation completed");
  }
  const temporary = `${output}.${randomUUID()}.mp4`;
  const process = Bun.spawn([
    "ffmpeg",
    ...offlineTranscodeArgs(source.abs, row.audio_index < 0 ? null : row.audio_index, temporary),
  ], { stdout: "pipe", stderr: "pipe" });
  const stderr = new Response(process.stderr).text();
  const progress = readTranscodeProgress(process.stdout, row.duration, (sample) => {
    updateProgress.run(sample.progress, sample.speed, Date.now(), row.id);
  });
  try {
    const [exitCode, errorText] = await Promise.all([process.exited, stderr, progress]);
    const result = exitCode === 0 ? await validOutput(temporary, row.duration) : null;
    if (result === null) {
      throw new Error(errorText.trim().slice(-500) || "Offline media validation failed");
    }
    await chmod(temporary, 0o600);
    await rename(temporary, output);
    finishArtifact.run(result.size, result.duration, Date.now(), row.id);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function processArtifact(row: ArtifactRow, options: OfflineMediaOptions): Promise<void> {
  startArtifact.run(Date.now(), row.id);
  try {
    await transcodeArtifact(row, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Offline media preparation failed";
    failArtifact.run(message.slice(0, 500), Date.now(), row.id);
  } finally {
    activeArtifacts.delete(row.id);
    runQueue(options);
  }
}

function runQueue(options: OfflineMediaOptions): void {
  const available = Math.max(0, MAX_WORKERS - activeArtifacts.size);
  const queued = artifacts.all().filter((row) => row.status === "queued");
  for (const row of queued.slice(0, available)) {
    activeArtifacts.add(row.id);
    void processArtifact(row, options);
  }
}

async function reusableArtifact(
  row: ArtifactRow,
  options: OfflineMediaOptions,
  expected: WriterSource["stats"],
): Promise<ArtifactRow> {
  if (row.direct === 1) {
    if (row.status !== "ready") {
      restoreDirectArtifact.run(Date.now(), row.id);
      return artifactById.get(row.id) as ArtifactRow;
    }
    return row;
  }
  const output = await artifactOutput(row, options);
  const missingOutput = row.status === "ready" &&
    (output === null || !(await Bun.file(output).exists()));
  if (row.status === "failed" || missingOutput) {
    await revalidateWriterSource(options.mediaRoot, row.source_rel, expected);
    requeueArtifact.run(Date.now(), row.id);
    return artifactById.get(row.id) as ArtifactRow;
  }
  return row;
}

async function createArtifact(
  source: Source,
  audio: { readonly index: number | null; readonly requiresSelection: boolean },
  setup: { readonly options: OfflineMediaOptions; readonly expected: WriterSource["stats"] },
): Promise<ArtifactRow> {
  const { options, expected } = setup;
  const id = randomUUID();
  const now = Date.now();
  const duration = await probeDuration(source.abs);
  await revalidateWriterSource(options.mediaRoot, source.rel, expected);
  const storedAudioIndex = audio.index ?? -1;
  const direct = source.direct && !audio.requiresSelection;
  const existing = matchingArtifact.get(
    source.rel, source.size, source.modifiedAt, storedAudioIndex, direct ? 1 : 0,
  );
  if (existing !== null) {
    return reusableArtifact(existing, options, expected);
  }
  const mimeType = direct
    ? MIME_TYPES.get(extname(source.abs).toLowerCase()) ?? "application/octet-stream"
    : "video/mp4";
  insertArtifact.run(
    id, source.rel, source.size, source.modifiedAt, storedAudioIndex, direct ? 1 : 0,
    direct ? null : `${id}.mp4`, direct ? "ready" : "queued", duration,
    direct ? source.size : null, mimeType, now, now,
  );
  return artifactById.get(id) as ArtifactRow;
}

async function prepareResponse(
  req: Request,
  options: OfflineMediaOptions,
  preferredAudioLanguage: string | null,
): Promise<Response> {
  const body = jsonObject(await req.json().catch(() => null));
  const path = body?.["path"];
  const requestedAudio = body?.["audioIndex"] ?? null;
  if (
    typeof path !== "string" || path === "" ||
    requestedAudio !== null && (typeof requestedAudio !== "number" || !Number.isInteger(requestedAudio) || requestedAudio < 0)
  ) {
    return new Response("Choose valid media and audio", { status: 400 });
  }
  return libraryWriterResponse({ root: options.mediaRoot, paths: [path], allowJobs: true }, (sources) => (
    prepareClaimedSource({ path, requestedAudio, preferredAudioLanguage }, options, sources[0]!.stats)
  ));
}

async function prepareClaimedSource(
  selection: { readonly path: string; readonly requestedAudio: number | null; readonly preferredAudioLanguage: string | null },
  options: OfflineMediaOptions, expected: WriterSource["stats"],
): Promise<Response> {
  const { path, requestedAudio, preferredAudioLanguage } = selection;
  const resolution = await resolveSource(path, options);
  if (resolution.source === null) {
    return new Response(resolution.error ?? "Video not found", { status: 404 });
  }
  const { source } = resolution;
  const audio = await selectedAudioIndex(source.abs, requestedAudio, preferredAudioLanguage);
  if (audio === undefined) {
    return new Response("Audio track not found", { status: 404 });
  }
  const row = await createArtifact(source, audio, { options, expected });
  runQueue(options);
  return artifactResponse(
    artifactById.get(row.id) as ArtifactRow,
    row.status === "ready" ? 200 : 202,
  );
}

function statusResponse(id: string, options: OfflineMediaOptions): Response {
  runQueue(options);
  const row = artifactById.get(id);
  return row === null
    ? new Response("Not found", { status: 404 })
    : artifactResponse(row);
}

export function offlineMediaApiResponse(
  req: Request,
  pathname: string,
  options: OfflineMediaOptions,
): Response | Promise<Response> | null {
  if (pathname === "/api/offline-media") {
    return req.method === "POST"
      ? prepareResponse(req, options, options.preferredAudioLanguage ?? null)
      : new Response("Method not allowed", { status: 405 });
  }
  const match = /^\/api\/offline-media\/(?<id>[0-9a-f-]+)$/u.exec(pathname);
  if (match?.groups !== undefined) {
    return req.method === "GET"
      ? statusResponse(match.groups["id"] ?? "", options)
      : new Response("Method not allowed", { status: 405 });
  }
  return null;
}

export function offlineMediaRouteResponse(
  req: Request,
  pathname: string,
  options: OfflineMediaOptions,
): Response | Promise<Response> | null {
  const api = offlineMediaApiResponse(req, pathname, options);
  if (api !== null) {
    return api;
  }
  const media = /^\/offline-media\/(?<id>[0-9a-f-]+)\/media$/u.exec(pathname);
  return media?.groups === undefined
    ? null
    : offlineMediaFileResponse(media.groups["id"] ?? "", req, options);
}

export async function offlineMediaFileResponse(
  id: string,
  req: Request,
  options: OfflineMediaOptions,
): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const row = artifactById.get(id);
  if (row === null || row.status !== "ready") {
    return new Response("Not found", { status: 404 });
  }
  const source = await sourceFor(row.source_rel, options);
  if (
    source === null || source.size !== row.source_size ||
    source.modifiedAt !== row.source_modified_at
  ) {
    return new Response("Source media changed", { status: 409 });
  }
  const path = row.direct === 1 ? source.abs : await artifactOutput(row, options);
  if (path === null || !(await Bun.file(path).exists())) {
    return new Response("Offline media unavailable", { status: 404 });
  }
  return rangedFileResponse({ path, mimeType: row.mime_type, etag: `"offline-${row.id}"`, req });
}
