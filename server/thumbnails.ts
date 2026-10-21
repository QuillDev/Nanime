import { createHash } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Bump when the ffmpeg arguments change so cached JPEGs are regenerated.
const CACHE_VERSION = 2;
const CACHE_ROOT = resolve(import.meta.dir, "..", ".nanime-cache", "thumbnails");
// Thumbnails are bursty (a season page asks for every episode at once); two
// short ffmpeg runs keep a cold page quick without competing with transcodes.
const MAX_JOBS = 2;
const BROWSER_CACHE = "private, max-age=604800";

const pending = new Map<string, Promise<string | null>>();
const waiting: (() => void)[] = [];
let activeJobs = 0;

interface CachedThumbnail {
  readonly path: string;
  readonly etag: string;
}

async function cachedThumbnail(abs: string): Promise<CachedThumbnail | null> {
  const source = await stat(abs).catch(() => null);
  if (source?.isFile() !== true) {
    return null;
  }
  const fingerprint = createHash("sha256")
    .update([String(CACHE_VERSION), abs, String(source.size), String(Math.trunc(source.mtimeMs))].join("\0"))
    .digest("hex")
    .slice(0, 32);
  return { path: join(CACHE_ROOT, `${fingerprint}.jpg`), etag: `"thumb-${fingerprint}"` };
}

function thumbnailArgs(abs: string, keyframesOnly: boolean): string[] {
  return [
    "ffmpeg", "-hide_banner", "-loglevel", "error",
    // Decoding keyframes only takes the first keyframe after 10 s without
    // decoding the GOP up to it (halves the run on 10-bit HEVC).
    ...(keyframesOnly ? ["-skip_frame", "nokey"] : []),
    "-ss", "10", "-i", abs,
    "-frames:v", "1", "-an", "-sn",
    "-vf", "scale=640:-2",
    "-c:v", "mjpeg", "-q:v", "4",
    "-f", "image2pipe", "pipe:1",
  ];
}

async function acquireSlot(): Promise<void> {
  if (activeJobs < MAX_JOBS) {
    activeJobs += 1;
    return;
  }
  // The releasing job hands its slot straight to the next waiter.
  const slot = Promise.withResolvers<void>();
  waiting.push(slot.resolve);
  await slot.promise;
}

function releaseSlot(): void {
  const next = waiting.shift();
  if (next === undefined) {
    activeJobs -= 1;
    return;
  }
  next();
}

async function runFfmpeg(args: readonly string[]): Promise<ArrayBuffer | null> {
  const proc = Bun.spawn([...args], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const bytes = await new Response(proc.stdout).arrayBuffer();
  const exitCode = await proc.exited;
  return exitCode === 0 && bytes.byteLength > 0 ? bytes : null;
}

async function renderThumbnail(abs: string): Promise<ArrayBuffer | null> {
  // No keyframe after 10 s (a short clip or a long final GOP): decode normally.
  return await runFfmpeg(thumbnailArgs(abs, true)) ?? await runFfmpeg(thumbnailArgs(abs, false));
}

async function storeThumbnail(target: string, bytes: ArrayBuffer): Promise<void> {
  await mkdir(CACHE_ROOT, { recursive: true });
  const temporary = `${target}.${String(process.pid)}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, new Uint8Array(bytes));
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function generateThumbnail(abs: string, target: string): Promise<string | null> {
  await acquireSlot();
  try {
    const bytes = await renderThumbnail(abs);
    if (bytes === null) {
      return null;
    }
    await storeThumbnail(target, bytes);
    return target;
  } finally {
    releaseSlot();
  }
}

async function thumbnailFile(abs: string, cached: CachedThumbnail): Promise<string | null> {
  if (await Bun.file(cached.path).exists()) {
    return cached.path;
  }
  const inFlight = pending.get(cached.path);
  if (inFlight !== undefined) {
    return inFlight;
  }
  const job = generateThumbnail(abs, cached.path);
  pending.set(cached.path, job);
  try {
    return await job;
  } finally {
    pending.delete(cached.path);
  }
}

/**
 * One JPEG frame per episode, rendered once and kept on disk across restarts
 * (keyed by path, size and mtime, so a replaced file gets a fresh frame).
 */
export async function thumbnailResponse(abs: string, req: Request): Promise<Response> {
  const cached = await cachedThumbnail(abs);
  if (cached === null) {
    return new Response("Thumbnail unavailable", { status: 404 });
  }
  const headers = { "cache-control": BROWSER_CACHE, etag: cached.etag };
  if (req.headers.get("if-none-match") === cached.etag) {
    return new Response(null, { status: 304, headers });
  }
  const file = await thumbnailFile(abs, cached);
  if (file === null) {
    return new Response("Thumbnail unavailable", { status: 404 });
  }
  return new Response(Bun.file(file), { headers: { ...headers, "content-type": "image/jpeg" } });
}
