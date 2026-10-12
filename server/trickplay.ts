import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { TrickplayManifest, TrickplayReady } from "../shared/types.ts";

const THUMBNAIL_WIDTH = 240;
const THUMBNAIL_HEIGHT = 136;
const TILE_COLUMNS = 5;
const TILE_ROWS = 5;
const TILES_PER_SHEET = TILE_COLUMNS * TILE_ROWS;
const TARGET_FRAME_COUNT = 300;
const MIN_INTERVAL_SECONDS = 5;
const INTERVAL_STEP_SECONDS = 5;
const CACHE_VERSION = 1;
const GENERATION_RETRY_MS = 5 * 60 * 1000;
const MAX_LIVE_FRAMES = 100;
const CACHE_ROOT = resolve(import.meta.dir, "..", ".nanime-cache", "trickplay");

interface SourceIdentity {
  readonly fingerprint: string;
  readonly modifiedAt: number;
  readonly size: number;
}

export interface TrickplayPlan {
  readonly interval: number;
  readonly frameCount: number;
  readonly sheetCount: number;
}

interface GenerationFailure {
  readonly retryAt: number;
}

interface GenerationJob {
  readonly abs: string;
  readonly duration: number;
}

const generationQueue: GenerationJob[] = [];
const generationPaths = new Set<string>();
const invalidatedPaths = new Set<string>();
const failures = new Map<string, GenerationFailure>();
const liveFrames = new Map<string, Promise<ArrayBuffer | null>>();
let generationActive = false;
let activeGenerationPath: string | null = null;
let activeLiveFrames = 0;

export function trickplayPlan(duration: number): TrickplayPlan {
  const interval = Math.max(
    MIN_INTERVAL_SECONDS,
    Math.ceil(duration / TARGET_FRAME_COUNT / INTERVAL_STEP_SECONDS) * INTERVAL_STEP_SECONDS,
  );
  const frameCount = Math.max(1, Math.ceil(duration / interval));
  return {
    interval,
    frameCount,
    sheetCount: Math.ceil(frameCount / TILES_PER_SHEET),
  };
}

function cacheKey(abs: string): string {
  const key = createHash("sha256").update(abs).digest("hex");
  if (!/^[\da-f]{64}$/u.test(key)) {
    throw new Error("Invalid trickplay cache key");
  }
  return key;
}

function cacheDirectory(abs: string): string {
  const directory = resolve(CACHE_ROOT, cacheKey(abs));
  if (!directory.startsWith(`${CACHE_ROOT}${sep}`)) {
    throw new Error("Invalid trickplay cache path");
  }
  return directory;
}

async function sourceIdentity(abs: string): Promise<SourceIdentity | null> {
  const stats = await lstat(abs).catch(() => null);
  if (stats?.isFile() !== true) {
    return null;
  }
  const modifiedAt = Math.trunc(stats.mtimeMs);
  return {
    modifiedAt,
    size: stats.size,
    fingerprint: createHash("sha256")
      .update([
        String(CACHE_VERSION),
        String(stats.size),
        String(modifiedAt),
        String(THUMBNAIL_WIDTH),
        String(THUMBNAIL_HEIGHT),
      ].join("\0"))
      .digest("hex")
      .slice(0, 16),
  };
}

function isReadyManifest(value: unknown): value is TrickplayReady & SourceIdentity {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const manifest = value as Partial<TrickplayReady & SourceIdentity>;
  return manifest.status === "ready" &&
    typeof manifest.version === "string" &&
    typeof manifest.fingerprint === "string" &&
    typeof manifest.modifiedAt === "number" &&
    typeof manifest.size === "number" &&
    typeof manifest.interval === "number" &&
    typeof manifest.width === "number" &&
    typeof manifest.height === "number" &&
    typeof manifest.columns === "number" &&
    typeof manifest.rows === "number" &&
    typeof manifest.frameCount === "number" &&
    typeof manifest.sheetCount === "number";
}

async function cachedManifest(abs: string): Promise<TrickplayReady | null> {
  const manifestPath = join(cacheDirectory(abs), "manifest.json");
  const [identity, text] = await Promise.all([
    sourceIdentity(abs),
    readFile(manifestPath, "utf8").catch(() => null),
  ]);
  if (identity === null || text === null) {
    return null;
  }
  const parsed: unknown = JSON.parse(text);
  if (!isReadyManifest(parsed) || parsed.fingerprint !== identity.fingerprint) {
    return null;
  }
  const { fingerprint: _fingerprint, modifiedAt: _modifiedAt, size: _size, ...manifest } = parsed;
  return manifest;
}

function scaleFilter(): string {
  return [
    `scale=${String(THUMBNAIL_WIDTH)}:${String(THUMBNAIL_HEIGHT)}:force_original_aspect_ratio=decrease`,
    `pad=${String(THUMBNAIL_WIDTH)}:${String(THUMBNAIL_HEIGHT)}:(ow-iw)/2:(oh-ih)/2:black`,
    "setsar=1",
  ].join(",");
}

interface SheetCommand {
  readonly abs: string;
  readonly output: string;
  readonly start: number;
  readonly duration: number;
  readonly interval: number;
}

export function trickplaySheetArgs(command: SheetCommand): readonly string[] {
  return [
    "-hide_banner", "-loglevel", "error",
    "-threads", "1", "-ss", String(command.start), "-i", command.abs,
    "-t", String(command.duration), "-an", "-sn",
    "-vf", `fps=1/${String(command.interval)},${scaleFilter()},tile=${String(TILE_COLUMNS)}x${String(TILE_ROWS)}`,
    "-frames:v", "1", "-q:v", "5", "-fps_mode", "vfr", "-y", command.output,
  ];
}

export function trickplayFrameArgs(abs: string, time: number): readonly string[] {
  return [
    "-hide_banner", "-loglevel", "error",
    "-ss", String(time), "-i", abs,
    "-frames:v", "1", "-an", "-sn",
    "-vf", scaleFilter(),
    "-c:v", "mjpeg", "-q:v", "5", "-f", "image2pipe", "pipe:1",
  ];
}

async function generateSheet(args: readonly string[]): Promise<void> {
  const process = Bun.spawn(["ffmpeg", ...args], { stdout: "ignore", stderr: "pipe" });
  const [error, exitCode] = await Promise.all([
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(error.trim() || `FFmpeg exited with code ${String(exitCode)}`);
  }
}

async function generateTrickplay(abs: string, duration: number): Promise<void> {
  const identity = await sourceIdentity(abs);
  if (identity === null) {
    throw new Error("Video no longer exists");
  }
  const plan = trickplayPlan(duration);
  await mkdir(CACHE_ROOT, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(CACHE_ROOT, `.tmp-${cacheKey(abs)}-`));
  try {
    let sheet = 0;
    while (sheet < plan.sheetCount) {
      const start = sheet * TILES_PER_SHEET * plan.interval;
      const remaining = Math.max(plan.interval, duration - start);
      const sheetDuration = Math.min(TILES_PER_SHEET * plan.interval, remaining);
      const output = join(temporary, `sheet-${String(sheet).padStart(3, "0")}.jpg`);
      await generateSheet(trickplaySheetArgs({
        abs,
        output,
        start,
        duration: sheetDuration,
        interval: plan.interval,
      }));
      sheet += 1;
    }
    const manifest = {
      status: "ready",
      version: identity.fingerprint,
      interval: plan.interval,
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
      columns: TILE_COLUMNS,
      rows: TILE_ROWS,
      frameCount: plan.frameCount,
      sheetCount: plan.sheetCount,
      ...identity,
    } satisfies TrickplayReady & SourceIdentity;
    await writeFile(join(temporary, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
    const destination = cacheDirectory(abs);
    await rm(destination, { recursive: true, force: true });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function manageGeneration(abs: string, duration: number): Promise<void> {
  try {
    await generateTrickplay(abs, duration);
    if (invalidatedPaths.has(abs)) {
      await rm(cacheDirectory(abs), { recursive: true, force: true });
    }
    failures.delete(abs);
  } catch (error) {
    failures.set(abs, { retryAt: Date.now() + GENERATION_RETRY_MS });
    const detail = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.error(`Trickplay generation failed: ${detail}`);
  }
}

async function drainGenerationQueue(): Promise<void> {
  if (generationActive) {
    return;
  }
  const job = generationQueue.shift();
  if (job === undefined) {
    return;
  }
  generationActive = true;
  activeGenerationPath = job.abs;
  await manageGeneration(job.abs, job.duration);
  generationPaths.delete(job.abs);
  activeGenerationPath = null;
  generationActive = false;
  void drainGenerationQueue();
}

function startGeneration(abs: string, duration: number): void {
  if (generationPaths.has(abs)) {
    return;
  }
  invalidatedPaths.delete(abs);
  generationPaths.add(abs);
  generationQueue.push({ abs, duration });
  void drainGenerationQueue();
}

export async function trickplayManifestResponse(abs: string, duration: number): Promise<Response> {
  const manifest = await cachedManifest(abs).catch(() => null);
  if (manifest !== null) {
    return Response.json(manifest, { headers: { "cache-control": "private, no-cache" } });
  }
  const failure = failures.get(abs);
  if (failure !== undefined && failure.retryAt > Date.now()) {
    return Response.json({ status: "unavailable" } satisfies TrickplayManifest, {
      headers: { "cache-control": "no-store" },
    });
  }
  startGeneration(abs, duration);
  return Response.json({ status: "generating" } satisfies TrickplayManifest, {
    status: 202,
    headers: { "cache-control": "no-store" },
  });
}

export async function trickplaySheetResponse(abs: string, version: string | null, index: number): Promise<Response> {
  const manifest = await cachedManifest(abs).catch(() => null);
  if (manifest === null || version !== manifest.version || index < 0 || index >= manifest.sheetCount) {
    return new Response("Not found", { status: 404 });
  }
  const file = Bun.file(join(cacheDirectory(abs), `sheet-${String(index).padStart(3, "0")}.jpg`));
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(file, {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}

async function waitForLiveFrameSlot(): Promise<void> {
  if (activeLiveFrames < 2) {
    return;
  }
  await Bun.sleep(20);
  return waitForLiveFrameSlot();
}

async function renderLiveFrame(abs: string, time: number): Promise<ArrayBuffer | null> {
  await waitForLiveFrameSlot();
  activeLiveFrames += 1;
  try {
    const process = Bun.spawn(["ffmpeg", ...trickplayFrameArgs(abs, time)], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const bytes = await new Response(process.stdout).arrayBuffer();
    const exitCode = await process.exited;
    return exitCode === 0 && bytes.byteLength > 0 ? bytes : null;
  } finally {
    activeLiveFrames -= 1;
  }
}

function rememberLiveFrame(key: string, pending: Promise<ArrayBuffer | null>): void {
  liveFrames.set(key, pending);
  while (liveFrames.size > MAX_LIVE_FRAMES) {
    const oldest = liveFrames.keys().next().value as string | undefined;
    if (oldest === undefined) {
      return;
    }
    liveFrames.delete(oldest);
  }
}

export async function trickplayFrameResponse(abs: string, duration: number, requestedTime: number): Promise<Response> {
  const identity = await sourceIdentity(abs);
  if (identity === null) {
    return new Response("Not found", { status: 404 });
  }
  const { interval } = trickplayPlan(duration);
  const time = Math.min(Math.floor(requestedTime / interval) * interval, Math.max(0, duration - 0.1));
  const key = `${abs}\0${identity.fingerprint}\0${String(time)}`;
  const pending = liveFrames.get(key) ?? renderLiveFrame(abs, time);
  if (!liveFrames.has(key)) {
    rememberLiveFrame(key, pending);
  }
  const bytes = await pending;
  if (bytes === null) {
    liveFrames.delete(key);
    return new Response("Thumbnail unavailable", { status: 404 });
  }
  return new Response(bytes, {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "private, max-age=3600",
    },
  });
}

export async function removeTrickplayCache(abs: string): Promise<void> {
  invalidatedPaths.add(abs);
  if (activeGenerationPath !== abs) {
    generationPaths.delete(abs);
  }
  let index = generationQueue.findIndex((job) => job.abs === abs);
  while (index >= 0) {
    generationQueue.splice(index, 1);
    index = generationQueue.findIndex((job) => job.abs === abs);
  }
  await rm(cacheDirectory(abs), { recursive: true, force: true });
  for (const key of liveFrames.keys()) {
    if (key.startsWith(`${abs}\0`)) {
      liveFrames.delete(key);
    }
  }
}

/**
 * Carries a finished trickplay cache to a moved video. The cache fingerprint
 * uses size and modification time, which a same-volume rename preserves.
 * Best effort: a missed migration only means the sheets are regenerated.
 */
export async function moveTrickplayCache(fromAbs: string, toAbs: string): Promise<void> {
  if (activeGenerationPath === fromAbs || generationPaths.has(fromAbs)) {
    return;
  }
  const destination = cacheDirectory(toAbs);
  if (await lstat(destination).catch((): null => null) !== null) {
    return;
  }
  await rename(cacheDirectory(fromAbs), destination).catch(() => undefined);
}

interface TrickplayMediaRequest {
  readonly abs: string;
  readonly pathname: string;
  readonly url: URL;
  readonly duration: () => Promise<number>;
}

export async function trickplayMediaResponse(request: TrickplayMediaRequest): Promise<Response | null> {
  const { abs, pathname, url } = request;
  if (pathname === "/trickplay/sheet") {
    const index = Number(url.searchParams.get("index") ?? "");
    return Number.isInteger(index)
      ? trickplaySheetResponse(abs, url.searchParams.get("version"), index)
      : new Response("Bad request", { status: 400 });
  }
  if (pathname === "/trickplay/frame") {
    const time = Number(url.searchParams.get("time") ?? "");
    return Number.isFinite(time) && time >= 0
      ? trickplayFrameResponse(abs, await request.duration(), time)
      : new Response("Bad request", { status: 400 });
  }
  return null;
}
