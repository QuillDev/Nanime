import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import type { Server } from "bun";
import {
  aniListErrorResponse,
  linkAniListResponse,
  metadataResponse,
  searchAniListResponse,
} from "./anilist.ts";
import { dismissPlaybackProgress, playbackProgressResponse, updatePlaybackProgress } from "./playback.ts";
import {
  audioTracksResponse,
  hlsPlaylist,
  hlsSegment,
  subtitleResponse,
  subtitleTracksResponse,
} from "./subtitles.ts";
import { torrentsResponse } from "./torrents.ts";
import { mediaAdminResponse } from "./mediaAdmin.ts";
import {
  authenticatedUser,
  aniListPublicAuthResponse,
  aniListUserResponse,
  authResponse,
  clientAddress,
  requestOriginAllowed,
  securityHeaders,
  syncAniListPlayback,
  usersResponse,
  type AuthUser,
} from "./security.ts";

const MEDIA_DIR = resolve(
  process.env["MEDIA_DIR"] ?? resolve(import.meta.dir, "..", "media"),
);
const DIST_DIR = resolve(import.meta.dir, "..", "dist");
const PORT = Number(process.env["PORT"] ?? "8096");
const HOST = process.env["HOST"] ?? "127.0.0.1";
const HWACCEL = process.env["HWACCEL"] ?? "";
const VAAPI_DEVICE = process.env["VAAPI_DEVICE"] ?? "/dev/dri/renderD128";
const MAX_THUMBNAIL_JOBS = 1;
const MAX_REQUEST_BODY_BYTES = 11 * 1024 * 1024;
const MEDIA_ROOT = await realpath(MEDIA_DIR).catch(() => MEDIA_DIR);
const VIDEO_EXTS = new Set<string>([
  ".mp4", ".m4v", ".webm", ".mov", ".mkv", ".avi", ".ts", ".m2ts",
  ".wmv", ".flv", ".mpg", ".mpeg", ".ogv", ".3gp",
]);
const DIRECT_PLAY = new Set<string>([".mp4", ".m4v", ".webm", ".mov", ".ogv"]);
const MIME: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
  ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
  ".ts": "video/mp2t", ".m2ts": "video/mp2t", ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv", ".mpg": "video/mpeg", ".mpeg": "video/mpeg",
  ".ogv": "video/ogg", ".3gp": "video/3gpp",
};

interface MediaEntry {
  readonly rel: string;
  readonly name: string;
  readonly folder: string;
  readonly size: number;
  readonly direct: boolean;
}

const durationCache = new Map<string, number>();
const thumbnailCache = new Map<string, Promise<ArrayBuffer | null>>();
let activeThumbnailJobs = 0;

async function walk(dir: string, acc: MediaEntry[]): Promise<void> {
  const items: readonly Dirent[] = await readdir(dir, {
    withFileTypes: true,
  }).catch((): Dirent[] => []);

  for (const item of items) {
    const abs = join(dir, item.name);
    if (item.isDirectory() && !item.name.startsWith(".nanime-")) {
      await walk(abs, acc);
    } else if (item.isFile() && VIDEO_EXTS.has(extname(item.name).toLowerCase())) {
      const { size } = await stat(abs).catch(() => ({ size: 0 }));
      const rel = relative(MEDIA_DIR, abs);
      const folder = dirname(rel);
      acc.push({
        rel,
        name: item.name,
        folder: folder === "." ? "" : folder,
        size,
        direct: DIRECT_PLAY.has(extname(item.name).toLowerCase()),
      });
    }
  }
}

async function listMedia(): Promise<readonly MediaEntry[]> {
  const acc: MediaEntry[] = [];
  await walk(MEDIA_DIR, acc);
  return acc;
}

async function safePath(rel: string | null): Promise<string | null> {
  if (rel === null || rel === "") {
    return null;
  }
  const abs = resolve(MEDIA_DIR, rel);
  if (abs !== MEDIA_DIR && !abs.startsWith(MEDIA_DIR + sep)) {
    return null;
  }
  const canonical = await realpath(abs).catch((): null => null);
  return canonical !== null && canonical !== MEDIA_ROOT && canonical.startsWith(MEDIA_ROOT + sep)
    ? canonical
    : null;
}

function contentType(abs: string): string {
  return MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
}

async function probeDuration(abs: string): Promise<number> {
  const cached = durationCache.get(abs);
  if (cached !== undefined) {
    return cached;
  }
  const proc = Bun.spawn(
    [
      "ffprobe", "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      abs,
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  const text = await new Response(proc.stdout).text();
  const duration = Number(text.trim());
  const seconds = Number.isFinite(duration) && duration > 0 ? duration : 0;
  durationCache.set(abs, seconds);
  return seconds;
}

function streamFile(abs: string, req: Request): Response {
  const file = Bun.file(abs);
  const { size } = file;
  const type = contentType(abs);
  const range = req.headers.get("range");
  const match = range === null ? null : /bytes=(?<start>\d*)-(?<end>\d*)/u.exec(range);

  if (match?.groups) {
    const startRaw = match.groups["start"] ?? "";
    const endRaw = match.groups["end"] ?? "";
    const start = startRaw === "" ? 0 : Number(startRaw);
    const requestedEnd = endRaw === "" ? size - 1 : Number(endRaw);
    const end = requestedEnd >= size ? size - 1 : requestedEnd;

    if (start > end || start >= size) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: { "content-range": `bytes */${String(size)}` },
      });
    }
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: {
        "content-type": type,
        "content-range": `bytes ${String(start)}-${String(end)}/${String(size)}`,
        "accept-ranges": "bytes",
        "content-length": String(end - start + 1),
      },
    });
  }

  return new Response(file, {
    headers: {
      "content-type": type,
      "accept-ranges": "bytes",
      "content-length": String(size),
    },
  });
}

async function renderThumbnail(abs: string): Promise<ArrayBuffer | null> {
  const proc = Bun.spawn(
    [
      "ffmpeg", "-hide_banner", "-loglevel", "error",
      "-ss", "10", "-i", abs,
      "-frames:v", "1", "-an", "-sn",
      "-vf", "scale=640:-2",
      "-c:v", "mjpeg", "-q:v", "4",
      "-f", "image2pipe", "pipe:1",
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  const bytes = await new Response(proc.stdout).arrayBuffer();
  const exitCode = await proc.exited;
  return exitCode === 0 && bytes.byteLength > 0 ? bytes : null;
}

async function waitForThumbnailSlot(): Promise<void> {
  if (activeThumbnailJobs < MAX_THUMBNAIL_JOBS) {
    return;
  }
  await Bun.sleep(25);
  return waitForThumbnailSlot();
}

async function generateThumbnail(abs: string): Promise<ArrayBuffer | null> {
  await waitForThumbnailSlot();
  activeThumbnailJobs += 1;
  try {
    return await renderThumbnail(abs);
  } finally {
    activeThumbnailJobs -= 1;
  }
}

async function thumbnailResponse(abs: string): Promise<Response> {
  const pending = thumbnailCache.get(abs) ?? generateThumbnail(abs);
  thumbnailCache.set(abs, pending);
  const bytes = await pending;
  if (bytes === null) {
    thumbnailCache.delete(abs);
    return new Response("Thumbnail unavailable", { status: 404 });
  }
  return new Response(bytes, {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "private, max-age=604800",
    },
  });
}

async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/u, "");
  const candidate = resolve(DIST_DIR, rel);
  if (candidate === DIST_DIR || candidate.startsWith(DIST_DIR + sep)) {
    const file = Bun.file(candidate);
    if (await file.exists()) {
      // Hashed assets are immutable; index.html must never be cached or the
      // browser can keep loading a deleted bundle after a deploy.
      const cache = rel.startsWith("assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache";
      return new Response(file, { headers: { "cache-control": cache } });
    }
  }
  const index = Bun.file(join(DIST_DIR, "index.html"));
  if (await index.exists()) {
    return new Response(index, { headers: { "cache-control": "no-cache" } });
  }
  return new Response("Not found", { status: 404 });
}

async function handleMedia(pathname: string, url: URL, req: Request): Promise<Response> {
  const abs = await safePath(url.searchParams.get("path"));
  if (abs === null || !VIDEO_EXTS.has(extname(abs).toLowerCase())) {
    return new Response("Not found", { status: 404 });
  }
  if (pathname === "/stream") {
    return streamFile(abs, req);
  }
  if (pathname === "/thumbnail") {
    return thumbnailResponse(abs);
  }
  if (pathname === "/api/subtitles" && req.method === "GET") {
    return subtitleTracksResponse(abs, url.searchParams.get("path") ?? "");
  }
  if (pathname === "/api/audio-tracks" && req.method === "GET") {
    return audioTracksResponse(abs, url.searchParams.get("path") ?? "");
  }
  if (pathname === "/subtitle") {
    const index = Number(url.searchParams.get("index") ?? "");
    return Number.isInteger(index)
      ? subtitleResponse(abs, index)
      : new Response("Bad request", { status: 400 });
  }
  if (pathname === "/hls/index") {
    const audioIndex = optionalAudioIndex(url);
    if (audioIndex === undefined) {
      return new Response("Bad request", { status: 400 });
    }
    return hlsPlaylist(relative(MEDIA_ROOT, abs), await probeDuration(abs), audioIndex);
  }
  const index = Number(url.searchParams.get("i") ?? "");
  if (!Number.isInteger(index) || index < 0) {
    return new Response("Bad request", { status: 400 });
  }
  const audioIndex = optionalAudioIndex(url);
  return audioIndex === undefined
    ? new Response("Bad request", { status: 400 })
    : hlsSegment({
        abs,
        index,
        audioIndex,
        duration: await probeDuration(abs),
        request: req,
        hardwareAcceleration: HWACCEL,
        vaapiDevice: VAAPI_DEVICE,
      });
}

function optionalAudioIndex(url: URL): number | null | undefined {
  const value = url.searchParams.get("audio");
  if (value === null) {
    return null;
  }
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

interface RouteContext {
  readonly pathname: string;
  readonly url: URL;
  readonly req: Request;
  readonly user: AuthUser;
}

async function authenticatedRoute(context: RouteContext): Promise<Response> {
  const { pathname, url, req, user } = context;
  if (pathname === "/api/list" && req.method === "GET") {
    return Response.json(await listMedia());
  }
  if (pathname === "/api/metadata" && req.method === "GET") {
    return metadataResponse();
  }
  if (pathname === "/api/progress" && req.method === "GET") {
    return playbackProgressResponse(user.id);
  }
  if (pathname === "/api/progress" && req.method === "PUT") {
    return updatePlaybackProgress(
      req,
      user.id,
      {
        mediaExists: async (rel): Promise<boolean> => {
          const abs = await safePath(rel);
          return abs !== null && await Bun.file(abs).exists();
        },
        sync: (target) => syncAniListPlayback(user.id, target),
      },
    );
  }
  if (pathname === "/api/progress/dismiss" && req.method === "POST") {
    return dismissPlaybackProgress(req, user.id);
  }
  const aniListUser = await aniListUserResponse(pathname, req, user);
  if (aniListUser !== null) {
    return aniListUser;
  }
  if (pathname === "/api/anilist/search" && req.method === "GET") {
    return user.isAdmin
      ? searchAniListResponse(url)
      : new Response("Forbidden", { status: 403 });
  }
  if (pathname === "/api/anilist/link" && req.method === "POST") {
    return user.isAdmin
      ? linkAniListResponse(req)
      : new Response("Forbidden", { status: 403 });
  }
  if (pathname === "/api/users" || pathname.startsWith("/api/users/")) {
    const requestedUserId = pathname === "/api/users" ? null : Number(pathname.slice(11));
    return usersResponse(req, user, requestedUserId);
  }
  if (pathname === "/api/torrents" || pathname.startsWith("/api/torrents/")) {
    return user.isAdmin
      ? torrentsResponse(req, MEDIA_DIR, url)
      : new Response("Forbidden", { status: 403 });
  }
  const mediaAdmin = mediaAdminResponse(req, pathname, {
    isAdmin: user.isAdmin,
    userId: user.id,
    mediaDir: MEDIA_DIR,
    mediaRoot: MEDIA_ROOT,
    videoExtensions: VIDEO_EXTS,
  });
  if (mediaAdmin !== null) {
    return await mediaAdmin;
  }
  if (pathname === "/api/subtitles") {
    return await handleMedia(pathname, url, req);
  }
  if (pathname === "/api/audio-tracks" && req.method === "GET") {
    return await handleMedia(pathname, url, req);
  }
  if ((req.method === "GET" || req.method === "HEAD") && (
    pathname === "/stream" ||
    pathname === "/thumbnail" ||
    pathname === "/subtitle" ||
    pathname === "/hls/index" ||
    pathname === "/hls/seg"
  )) {
    return await handleMedia(pathname, url, req);
  }
  if (pathname.startsWith("/api/")) {
    return new Response("Not found", { status: 404 });
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  return await serveStatic(pathname);
}

function protectedPath(pathname: string): boolean {
  return pathname.startsWith("/api/") ||
    pathname === "/stream" ||
    pathname === "/thumbnail" ||
    pathname === "/subtitle" ||
    pathname.startsWith("/hls/");
}

interface RequestContext {
  readonly pathname: string;
  readonly url: URL;
  readonly req: Request;
  readonly address: string;
}

async function route(context: RequestContext): Promise<Response> {
  const { pathname, url, req, address } = context;
  try {
    if (!requestOriginAllowed(req)) {
      return new Response("Forbidden", { status: 403 });
    }
    const aniListAuth = await aniListPublicAuthResponse(pathname, req, authenticatedUser(req));
    if (aniListAuth !== null) {
      return aniListAuth;
    }
    const auth = await authResponse(pathname, req, address);
    if (auth !== null) {
      return auth;
    }
    const user = authenticatedUser(req);
    if (user === null) {
      return protectedPath(pathname)
        ? new Response("Unauthorized", { status: 401 })
        : await serveStatic(pathname);
    }
    return await authenticatedRoute({ pathname, url, req, user });
  } catch (error) {
    return aniListErrorResponse(error) ?? new Response("Server error", { status: 500 });
  }
}

export async function handle(req: Request, server: Server<undefined> | null): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const response = await route({ pathname, url, req, address: clientAddress(req, server) });
  if (pathname.startsWith("/api") || pathname.startsWith("/hls") || response.status >= 400) {
    const suffix = url.searchParams.has("i") ? `&i=${url.searchParams.get("i") ?? ""}` : "";
    // eslint-disable-next-line no-console
    console.log(`${req.method} ${pathname}${suffix} -> ${String(response.status)}`);
  }
  return securityHeaders(response);
}

export const serverOptions = {
  port: PORT,
  hostname: HOST,
  idleTimeout: 0,
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
} as const;
