import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, realpath, rename, unlink } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { libraryWriterResponse, revalidateWriterSource, type WriterSource } from "./libraryWriterAdmission.ts";
import type { OfflineMediaArtifact } from "../shared/types.ts";
import { db, execute, type OfflineMediaArtifactRow, OfflineMediaArtifactRowSchema, queryOne, queryRows } from "./database.ts";
import { jsonObject } from "./json.ts";
import { probeDuration, selectedAudioIndex } from "./offlineMediaInspection.ts";
import { readTranscodeProgress } from "./transcodeProgress.ts";
import { rangedFileResponse } from "./httpRange.ts";

// Nanime's own folders, like the media library scan skips them. Trashed media
// keeps its artifact rows so Undo restores them, but is never served.
const INTERNAL_SEGMENT = /(?:^|[\\/])\.nanime-/iu;

type ArtifactRow = OfflineMediaArtifactRow;

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

function artifactById(id: string): ArtifactRow | null {
  return queryOne(db.selectFrom("offline_media_artifacts").selectAll().where("id", "=", id), OfflineMediaArtifactRowSchema);
}
function updateArtifact(id: string, change: Partial<Omit<ArtifactRow, "id" | "updated_at">>): void {
  execute(db.updateTable("offline_media_artifacts").set({ ...change, updated_at: Date.now() }).where("id", "=", id));
}

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
    updateArtifact(row.id, { progress: sample.progress, speed: sample.speed });
  });
  try {
    const [exitCode, errorText] = await Promise.all([process.exited, stderr, progress]);
    const result = exitCode === 0 ? await validOutput(temporary, row.duration) : null;
    if (result === null) {
      throw new Error(errorText.trim().slice(-500) || "Offline media validation failed");
    }
    await chmod(temporary, 0o600);
    await rename(temporary, output);
    updateArtifact(row.id, { status: "ready", progress: 1, speed: 0, size_bytes: result.size, duration: result.duration });
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function processArtifact(row: ArtifactRow, options: OfflineMediaOptions): Promise<void> {
  updateArtifact(row.id, { status: "preparing", progress: 0, speed: 0, error: null });
  try {
    await transcodeArtifact(row, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Offline media preparation failed";
    updateArtifact(row.id, { status: "failed", progress: 0, speed: 0, error: message.slice(0, 500) });
  } finally {
    activeArtifacts.delete(row.id);
    runQueue(options);
  }
}

function runQueue(options: OfflineMediaOptions): void {
  const available = Math.max(0, MAX_WORKERS - activeArtifacts.size);
  const all = queryRows(db.selectFrom("offline_media_artifacts").selectAll().orderBy("created_at"), OfflineMediaArtifactRowSchema);
  const queued = all.filter((row) => row.status === "queued");
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
      execute(db.updateTable("offline_media_artifacts")
        .set((columns) => ({ status: "ready", progress: 1, speed: 0, size_bytes: columns.ref("source_size"), error: null, updated_at: Date.now() }))
        .where("id", "=", row.id).where("direct", "=", 1));
      return artifactById(row.id) as ArtifactRow;
    }
    return row;
  }
  const output = await artifactOutput(row, options);
  const missingOutput = row.status === "ready" &&
    (output === null || !(await Bun.file(output).exists()));
  if (row.status === "failed" || missingOutput) {
    await revalidateWriterSource(options.mediaRoot, row.source_rel, expected);
    updateArtifact(row.id, { status: "queued", progress: 0, speed: 0, size_bytes: null, error: null });
    return artifactById(row.id) as ArtifactRow;
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
  const existing = queryOne(db.selectFrom("offline_media_artifacts").selectAll()
    .where("source_rel", "=", source.rel).where("source_size", "=", source.size).where("source_modified_at", "=", source.modifiedAt)
    .where("audio_index", "=", storedAudioIndex).where("direct", "=", direct ? 1 : 0), OfflineMediaArtifactRowSchema);
  if (existing !== null) {
    return reusableArtifact(existing, options, expected);
  }
  const mimeType = direct
    ? MIME_TYPES.get(extname(source.abs).toLowerCase()) ?? "application/octet-stream"
    : "video/mp4";
  execute(db.insertInto("offline_media_artifacts").values({
    id, source_rel: source.rel, source_size: source.size, source_modified_at: source.modifiedAt, audio_index: storedAudioIndex,
    direct: direct ? 1 : 0, output_name: direct ? null : `${id}.mp4`, status: direct ? "ready" : "queued", duration,
    size_bytes: direct ? source.size : null, mime_type: mimeType, created_at: now, updated_at: now,
  }));
  return artifactById(id) as ArtifactRow;
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
    artifactById(row.id) as ArtifactRow,
    row.status === "ready" ? 200 : 202,
  );
}

function statusResponse(id: string, options: OfflineMediaOptions): Response {
  runQueue(options);
  const row = artifactById(id);
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
  const row = artifactById(id);
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
