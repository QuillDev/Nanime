import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Bump when the encode settings change so cached images are re-made.
const CACHE_VERSION = 1;
const CACHE_ROOT = resolve(import.meta.dir, "..", ".nanime-cache", "art");
// Show art comes from AniList (covers, banners) and its streaming episode
// stills; nothing else is fetched, so this can't be used as an open proxy.
const ALLOWED_HOSTS = new Set(["s4.anilist.co", "img1.ak.crunchyroll.com"]);
export const ART_WIDTHS = [160, 320, 480, 640, 960, 1280, 1920] as const;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_JOBS = 2;
const BROWSER_CACHE = "private, max-age=31536000, immutable";

const sources = new Map<string, Promise<Uint8Array | null>>();
const renders = new Map<string, Promise<string | null>>();
const waiting: (() => void)[] = [];
let activeJobs = 0;

interface ArtRequest {
  readonly source: URL;
  readonly width: number;
}

function artRequest(url: URL): ArtRequest | null {
  const width = Number(url.searchParams.get("w"));
  const source = URL.parse(url.searchParams.get("src") ?? "");
  if (source?.protocol !== "https:" || !ALLOWED_HOSTS.has(source.hostname) || source.port !== "") {
    return null;
  }
  return ART_WIDTHS.some((allowed) => allowed === width) ? { source, width } : null;
}

function cachePath(request: ArtRequest): string {
  const key = createHash("sha256")
    .update([String(CACHE_VERSION), request.source.href, String(request.width)].join("\0"))
    .digest("hex")
    .slice(0, 40);
  return join(CACHE_ROOT, `${key}.webp`);
}

async function downloadSource(source: URL): Promise<Uint8Array | null> {
  const response = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => null);
  const length = Number(response?.headers.get("content-length") ?? 0);
  if (response?.ok !== true || !(response.headers.get("content-type") ?? "").startsWith("image/") || length > MAX_SOURCE_BYTES) {
    return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength > 0 && bytes.byteLength <= MAX_SOURCE_BYTES ? bytes : null;
}

async function sourceBytes(source: URL): Promise<Uint8Array | null> {
  const inFlight = sources.get(source.href);
  if (inFlight !== undefined) {
    return inFlight;
  }
  const job = downloadSource(source);
  sources.set(source.href, job);
  try {
    return await job;
  } catch {
    return null;
  } finally {
    sources.delete(source.href);
  }
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

async function encodeWebp(bytes: Uint8Array, width: number): Promise<ArrayBuffer | null> {
  await acquireSlot();
  try {
    const proc = Bun.spawn([
      "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
      // Never upscale: a 460 px cover asked for at 640 stays 460.
      "-vf", `scale='min(${String(width)},iw)':-2:flags=lanczos`,
      "-frames:v", "1", "-c:v", "libwebp", "-quality", "78", "-f", "webp", "pipe:1",
    ], { stdin: bytes, stdout: "pipe", stderr: "ignore" });
    const output = await new Response(proc.stdout).arrayBuffer();
    const exitCode = await proc.exited;
    return exitCode === 0 && output.byteLength > 0 ? output : null;
  } finally {
    releaseSlot();
  }
}

async function store(target: string, bytes: ArrayBuffer): Promise<void> {
  await mkdir(CACHE_ROOT, { recursive: true });
  const temporary = `${target}.${String(process.pid)}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, new Uint8Array(bytes));
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function render(request: ArtRequest, target: string): Promise<string | null> {
  const original = await sourceBytes(request.source);
  const encoded = original === null ? null : await encodeWebp(original, request.width);
  if (encoded === null) {
    return null;
  }
  await store(target, encoded);
  return target;
}

async function artFile(request: ArtRequest): Promise<string | null> {
  const target = cachePath(request);
  if (await Bun.file(target).exists()) {
    return target;
  }
  const inFlight = renders.get(target);
  if (inFlight !== undefined) {
    return inFlight;
  }
  const job = render(request, target);
  renders.set(target, job);
  try {
    return await job;
  } finally {
    renders.delete(target);
  }
}

/**
 * `/api/art?src=<AniList image>&w=<width>`: the image resized to the width the
 * page shows it at, as WebP, made once and kept on disk. A 1900 px banner in a
 * 300 px tile drops from ~330 KB to ~30 KB. If the image can't be fetched or
 * converted, the browser is sent to the original instead.
 */
export async function artResponse(url: URL): Promise<Response> {
  const request = artRequest(url);
  if (request === null) {
    return new Response("Unsupported image", { status: 400 });
  }
  const file = await artFile(request);
  if (file === null) {
    return Response.redirect(request.source.href, 302);
  }
  return new Response(Bun.file(file), { headers: { "content-type": "image/webp", "cache-control": BROWSER_CACHE } });
}
