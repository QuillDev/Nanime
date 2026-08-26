import { realpath } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { Server } from "bun";
import {
  aniListErrorResponse,
  linkAniListResponse,
  linkJikanResponse,
  jikanErrorResponse,
  metadataResponse,
  metadataRefreshStatusResponse,
  searchAniListResponse,
  searchJikanResponse,
  startMetadataRefreshResponse,
  updateMetadataAniListIdResponse,
} from "./anilist.ts";
import { dismissPlaybackProgress, playbackProgressResponse, setPlaybackWatchedState, updatePlaybackProgress } from "./playback.ts";
import {
  audioTracksResponse,
  hlsPlaylistResponse,
  hlsSegmentResponse,
  probeDuration,
  subtitleResponse,
  subtitleTracksResponse,
  trickplayManifestResponse,
  trickplayMediaResponse,
} from "./subtitles.ts";
import { torrentsResponse } from "./torrents.ts";
import { mediaAdminResponse } from "./mediaAdmin.ts";
import {
  libraryStatusResponse,
  listMedia,
  refreshLibraryResponse,
} from "./mediaLibrary.ts";
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

const MEDIA_DIR = resolve(Bun.env["MEDIA_DIR"] ?? resolve(import.meta.dir, "..", "media"));
const DIST_DIR = resolve(import.meta.dir, "..", "dist");
const PORT = Number(process.env["PORT"] ?? "8096");
const HOST = process.env["HOST"] ?? "127.0.0.1";
const HWACCEL = process.env["HWACCEL"] ?? "";
const VAAPI_DEVICE = process.env["VAAPI_DEVICE"] ?? "/dev/dri/renderD128";
const MAX_THUMBNAIL_JOBS = 1;
const MAX_REQUEST_BODY_BYTES = 11 * 1024 * 1024;
// MEDIA_DIR is trusted process configuration. This canonical root is used to validate
// every request-derived media path before it reaches the filesystem.
const MEDIA_ROOT = await realpath(MEDIA_DIR).catch(() => MEDIA_DIR);
const VIDEO_EXTS = new Set<string>([
  ".mp4", ".m4v", ".webm", ".mov", ".mkv", ".avi", ".ts", ".m2ts",
  ".wmv", ".flv", ".mpg", ".mpeg", ".ogv", ".3gp",
]);
const DIRECT_PLAY = new Set<string>([".mp4", ".m4v", ".webm", ".mov", ".ogv"]);
const MIME = new Map(Object.entries({
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
  ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
  ".ts": "video/mp2t", ".m2ts": "video/mp2t", ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv", ".mpg": "video/mpeg", ".mpeg": "video/mpeg",
  ".ogv": "video/ogg", ".3gp": "video/3gpp",
} as const));

const thumbnailCache = new Map<string, Promise<ArrayBuffer | null>>();
let activeThumbnailJobs = 0;
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
async function mediaExists(rel: string): Promise<boolean> {
  const abs = await safePath(rel);
  return abs !== null && await Bun.file(abs).exists();
}
function contentType(abs: string): string {
  return MIME.get(extname(abs).toLowerCase()) ?? "application/octet-stream";
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

async function handleMedia(context: RouteContext): Promise<Response> {
  const { pathname, url, req, user } = context;
  if (pathname === "/hls/seg") {
    return hlsSegmentResponse(
      url.searchParams.get("session"),
      url.searchParams.get("name"),
      user.id,
    );
  }
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
  const trickplay = await trickplayMediaResponse({ abs, pathname, url, duration: () => probeDuration(abs) });
  if (trickplay !== null) {
    return trickplay;
  }
  if (pathname === "/api/subtitles" && req.method === "GET") {
    return subtitleTracksResponse(abs, url.searchParams.get("path") ?? "");
  }
  if (pathname === "/api/audio-tracks" && req.method === "GET") {
    return audioTracksResponse(abs, url.searchParams.get("path") ?? "");
  }
  if (pathname === "/subtitle") {
    const index = Number(url.searchParams.get("index") ?? "");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    return Number.isInteger(index)
      ? subtitleResponse(abs, index, offset)
      : new Response("Bad request", { status: 400 });
  }
  if (pathname === "/hls/index") {
    const audioIndex = optionalAudioIndex(url);
    if (audioIndex === undefined) {
      return new Response("Bad request", { status: 400 });
    }
    const requestedStart = Number(url.searchParams.get("start") ?? "0");
    if (!Number.isFinite(requestedStart) || requestedStart < 0) {
      return new Response("Bad request", { status: 400 });
    }
    return hlsPlaylistResponse({
      abs,
      audioIndex,
      duration: await probeDuration(abs),
      requestedStart,
      userId: user.id,
      hardwareAcceleration: HWACCEL,
      vaapiDevice: VAAPI_DEVICE,
    });
  }
  return new Response("Not found", { status: 404 });
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

async function libraryRoute(context: RouteContext): Promise<Response | null> {
  const { pathname, url, req, user } = context;
  if (pathname === "/api/list" && req.method === "GET") {
    return Response.json(await listMedia({
      mediaDir: MEDIA_DIR,
      videoExtensions: VIDEO_EXTS,
      directPlayExtensions: DIRECT_PLAY,
    }));
  }
  if (pathname === "/api/metadata" && req.method === "GET") {
    return metadataResponse();
  }
  if (pathname === "/api/media-info" && req.method === "GET") {
    const abs = await safePath(url.searchParams.get("path"));
    if (abs === null || !VIDEO_EXTS.has(extname(abs).toLowerCase())) {
      return new Response("Not found", { status: 404 });
    }
    return Response.json({ duration: await probeDuration(abs) });
  }
  if (pathname === "/api/trickplay" && req.method === "GET") {
    const abs = await safePath(url.searchParams.get("path"));
    if (abs === null || !VIDEO_EXTS.has(extname(abs).toLowerCase())) {
      return new Response("Not found", { status: 404 });
    }
    return trickplayManifestResponse(abs, await probeDuration(abs));
  }
  if (pathname === "/api/progress" && req.method === "GET") {
    return playbackProgressResponse(user.id);
  }
  if (pathname === "/api/progress" && req.method === "PUT") {
    return updatePlaybackProgress(
      req,
      user.id,
      {
        mediaExists,
        sync: (target) => syncAniListPlayback(user.id, target),
      },
    );
  }
  if (pathname === "/api/progress/dismiss" && req.method === "POST") {
    return dismissPlaybackProgress(req, user.id);
  }
  if (pathname === "/api/progress/watched" && req.method === "POST") {
    return setPlaybackWatchedState(req, user.id, {
      mediaExists, sync: (target) => syncAniListPlayback(user.id, target),
    });
  }
  return null;
}

async function administrationRoute(context: RouteContext): Promise<Response | null> {
  const { pathname, url, req, user } = context;
  if (pathname === "/api/library/status" && req.method === "GET") {
    return user.isAdmin
      ? libraryStatusResponse()
      : new Response("Forbidden", { status: 403 });
  }
  if (pathname === "/api/library/refresh" && req.method === "POST") {
    return user.isAdmin
      ? refreshLibraryResponse({
          mediaDir: MEDIA_DIR,
          videoExtensions: VIDEO_EXTS,
          directPlayExtensions: DIRECT_PLAY,
        })
      : new Response("Forbidden", { status: 403 });
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
  if (pathname === "/api/jikan/search" && req.method === "GET") {
    return user.isAdmin
      ? searchJikanResponse(url)
      : new Response("Forbidden", { status: 403 });
  }
  if (pathname === "/api/jikan/link" && req.method === "POST") {
    return user.isAdmin
      ? linkJikanResponse(req)
      : new Response("Forbidden", { status: 403 });
  }
  if (pathname === "/api/metadata/refresh" && req.method === "GET") {
    return user.isAdmin
      ? metadataRefreshStatusResponse()
      : new Response("Forbidden", { status: 403 });
  }
  if (pathname === "/api/metadata/anilist-id" && req.method === "PUT") {
    return user.isAdmin
      ? updateMetadataAniListIdResponse(req)
      : new Response("Forbidden", { status: 403 });
  }
  if (pathname === "/api/metadata/refresh" && req.method === "POST") {
    return user.isAdmin
      ? startMetadataRefreshResponse()
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
  return null;
}

function mediaRequest(pathname: string, method: string): boolean {
  if (pathname === "/api/subtitles") {
    return true;
  }
  if (pathname === "/api/audio-tracks" && method === "GET") {
    return true;
  }
  return (method === "GET" || method === "HEAD") && (
    pathname === "/stream" ||
    pathname === "/thumbnail" ||
    pathname === "/trickplay/sheet" ||
    pathname === "/trickplay/frame" ||
    pathname === "/subtitle" ||
    pathname === "/hls/index" ||
    pathname === "/hls/seg"
  );
}

async function authenticatedRoute(context: RouteContext): Promise<Response> {
  const library = await libraryRoute(context);
  if (library !== null) {
    return library;
  }
  const administration = await administrationRoute(context);
  if (administration !== null) {
    return administration;
  }
  const { pathname, req } = context;
  if (mediaRequest(pathname, req.method)) {
    return await handleMedia(context);
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
    pathname.startsWith("/trickplay/") ||
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
    return aniListErrorResponse(error) ?? jikanErrorResponse(error) ??
      new Response("Server error", { status: 500 });
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
  port: PORT, hostname: HOST, idleTimeout: 0, maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
} as const;
