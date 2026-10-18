import { realpath, stat } from "node:fs/promises";
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
import { playbackRoute } from "./playbackRoutes.ts";
import {
  audioTracksResponse,
  hlsPlaylistResponse,
  playbackPlan,
  playbackReadinessResponse,
  resumeTranscodeQueue,
  hlsSegmentResponse,
  offlineMediaRouteResponse,
  probeDuration,
  subtitleResponse,
  subtitleTracksResponse,
  trickplayManifestResponse,
  trickplayMediaResponse,
  hlsReleaseRouteResponse,
  mediaRequest,
  rangedFileResponse,
} from "./mediaRouting.ts";
import { adminLibraryRoutes } from "./adminLibraryRoutes.ts";
import { mediaAdminResponse } from "./mediaAdmin.ts";
import {
  isLibraryMediaPath,
  libraryStatusResponse,
  libraryActivityResponse,
  listMedia,
  mediaIdentityAt,
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
const RELEASE_SENSITIVE_HEADERS = {
  "cache-control": "no-store",
  "cdn-cache-control": "no-store",
  "cloudflare-cdn-cache-control": "no-store",
} as const;
const OFFLINE_MEDIA_OPTIONS = {
  mediaDir: MEDIA_DIR,
  mediaRoot: MEDIA_ROOT,
  videoExtensions: VIDEO_EXTS,
  directPlayExtensions: DIRECT_PLAY,
} as const;
const ADMIN_LIBRARY = adminLibraryRoutes({
  mediaDir: MEDIA_DIR,
  mediaRoot: MEDIA_ROOT,
  videoExtensions: VIDEO_EXTS,
  directPlayExtensions: DIRECT_PLAY,
});
await ADMIN_LIBRARY.recover();
const TRANSCODE_OPTIONS = { mediaDir: MEDIA_DIR, mediaRoot: MEDIA_ROOT, videoExtensions: VIDEO_EXTS } as const;
resumeTranscodeQueue(TRANSCODE_OPTIONS);
async function safePath(rel: string | null): Promise<string | null> {
  if (rel === null || rel === "") {
    return null;
  }
  const abs = resolve(MEDIA_DIR, rel);
  if (abs !== MEDIA_DIR && !abs.startsWith(MEDIA_DIR + sep)) {
    return null;
  }
  const canonical = await realpath(abs).catch((): null => null);
  // Nanime's own folders (trash awaiting Undo, uploads, transcodes) are never media.
  return canonical !== null && canonical !== MEDIA_ROOT && canonical.startsWith(MEDIA_ROOT + sep) &&
    isLibraryMediaPath(rel) && isLibraryMediaPath(canonical.slice(MEDIA_ROOT.length + 1))
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
async function streamFile(abs: string, req: Request): Promise<Response> {
  const information = await stat(abs);
  const etag = `"direct-${String(information.size)}-${String(Math.trunc(information.mtimeMs))}"`;
  return rangedFileResponse({
    path: abs,
    mimeType: contentType(abs),
    etag,
    req,
    cacheControl: "private, no-cache",
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
      const headers = rel.startsWith("assets/")
        ? { "cache-control": "public, max-age=31536000, immutable" }
        : RELEASE_SENSITIVE_HEADERS;
      return new Response(file, { headers });
    }
  }
  const index = Bun.file(join(DIST_DIR, "index.html"));
  if (await index.exists()) {
    return new Response(index, { headers: RELEASE_SENSITIVE_HEADERS });
  }
  return new Response("Not found", { status: 404 });
}

async function handleMedia(context: RouteContext): Promise<Response> {
  const { pathname, url, user } = context;
  if (pathname === "/api/hls/release") {
    return hlsReleaseRouteResponse(url, user.id);
  }
  if (pathname === "/hls/seg") {
    return hlsSegmentResponse({ sessionId: url.searchParams.get("session"),
      leaseId: url.searchParams.get("lease"), name: url.searchParams.get("name"),
      userId: user.id });
  }
  const abs = await safePath(url.searchParams.get("path"));
  if (abs === null || !VIDEO_EXTS.has(extname(abs).toLowerCase())) {
    return new Response("Not found", { status: 404 });
  }
  return resolvedMediaResponse(context, abs);
}

async function resolvedMediaResponse(context: RouteContext, abs: string): Promise<Response> {
  const { pathname, url, req } = context;
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
  return timedMediaResponse(context, abs);
}

async function timedMediaResponse(context: RouteContext, abs: string): Promise<Response> {
  const { pathname, url, user } = context;
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
    const plan = await playbackPlan(abs, url.searchParams.get("path") ?? "", { ...TRANSCODE_OPTIONS, hardwareAcceleration: HWACCEL });
    if (plan.kind === "transcode-required") {
      return new Response("This video must be transcoded before it can play", { status: 409 });
    }
    return hlsPlaylistResponse({
      abs,
      source: plan.source,
      audioIndex,
      duration: await probeDuration(abs),
      requestedStart,
      userId: user.id,
      leaseId: url.searchParams.get("lease"),
      playerId: url.searchParams.get("player"),
      preferredAudioLanguage: user.preferredAudioLanguage,
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
  const information = await libraryInformationRoute(context);
  return information ?? playbackRoute(context, {
    mediaExists,
    mediaIdentity: (rel) => mediaIdentityAt(MEDIA_ROOT, rel),
    sync: syncAniListPlayback,
  });
}

async function videoPath(rel: string): Promise<string | null> {
  const abs = await safePath(rel);
  return abs !== null && VIDEO_EXTS.has(extname(abs).toLowerCase()) ? abs : null;
}

function readinessRoute(req: Request): Promise<Response> {
  return playbackReadinessResponse(req, videoPath, { ...TRANSCODE_OPTIONS, hardwareAcceleration: HWACCEL });
}

async function libraryInformationRoute(context: RouteContext): Promise<Response | null> {
  const { pathname, url, req } = context;
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
  if (pathname === "/api/playback-readiness" && req.method === "POST") {
    return readinessRoute(req);
  }
  if (pathname === "/api/trickplay" && req.method === "GET") {
    const abs = await safePath(url.searchParams.get("path"));
    if (abs === null || !VIDEO_EXTS.has(extname(abs).toLowerCase())) {
      return new Response("Not found", { status: 404 });
    }
    return trickplayManifestResponse(abs, await probeDuration(abs));
  }
  return null;
}

const DIRECT_ADMIN_ROUTES = new Set([
  "GET /api/anilist/search",
  "GET /api/jikan/search",
  "GET /api/library/status",
  "GET /api/library/activity",
  "GET /api/metadata/refresh",
  "POST /api/anilist/link",
  "POST /api/jikan/link",
  "POST /api/library/refresh",
  "POST /api/metadata/refresh",
  "PUT /api/metadata/anilist-id",
]);

function directAdminResponse(context: RouteContext): Response | Promise<Response> {
  const { pathname, url, req, user } = context;
  switch (`${req.method} ${pathname}`) {
    case "GET /api/library/status": { return libraryStatusResponse(); }
    case "POST /api/library/refresh": { return refreshLibraryResponse({ mediaDir: MEDIA_DIR, videoExtensions: VIDEO_EXTS, directPlayExtensions: DIRECT_PLAY }); }
    case "GET /api/anilist/search": { return searchAniListResponse(url); }
    case "POST /api/anilist/link": { return linkAniListResponse(req, user); }
    case "GET /api/jikan/search": { return searchJikanResponse(url); }
    case "POST /api/jikan/link": { return linkJikanResponse(req, user); }
    case "GET /api/metadata/refresh": { return metadataRefreshStatusResponse(); }
    case "PUT /api/metadata/anilist-id": { return updateMetadataAniListIdResponse(req, user); }
    case "GET /api/library/activity": { return libraryActivityResponse(url); }
    case "POST /api/metadata/refresh": { return startMetadataRefreshResponse(); }
    default: { return new Response("Not found", { status: 404 }); }
  }
}

async function administrationRoute(context: RouteContext): Promise<Response | null> {
  const { pathname, url, req, user } = context;
  const aniListUser = await aniListUserResponse(pathname, req, user);
  if (aniListUser !== null) {
    return aniListUser;
  }
  if (DIRECT_ADMIN_ROUTES.has(`${req.method} ${pathname}`)) {
    return user.isAdmin ? directAdminResponse(context) : new Response("Forbidden", { status: 403 });
  }
  if (pathname === "/api/users" || pathname.startsWith("/api/users/")) {
    const requestedUserId = pathname === "/api/users" ? null : Number(pathname.slice(11));
    return usersResponse(req, user, requestedUserId);
  }
  const library = ADMIN_LIBRARY.respond({ req, pathname, url, user });
  if (library !== null) {
    return await library;
  }
  const mediaAdmin = mediaAdminResponse(req, pathname, {
    isAdmin: user.isAdmin,
    userId: user.id,
    username: user.username,
    mediaDir: MEDIA_DIR,
    mediaRoot: MEDIA_ROOT,
    videoExtensions: VIDEO_EXTS,
  });
  if (mediaAdmin !== null) {
    return await mediaAdmin;
  }
  return null;
}

async function authenticatedRoute(context: RouteContext): Promise<Response> {
  const offline = offlineMediaRouteResponse(
    context.req,
    context.pathname,
    { ...OFFLINE_MEDIA_OPTIONS, preferredAudioLanguage: context.user.preferredAudioLanguage },
  );
  if (offline !== null) {
    return await offline;
  }
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
  if (pathname.startsWith("/offline-download/")) {
    return new Response("Offline media requires the service worker", { status: 404 });
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
    pathname.startsWith("/offline-download/") ||
    pathname.startsWith("/offline-media/") ||
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
    console.log(`${req.method} ${pathname.replace(/\/api\/watch-together\/[^/]+/u, "/api/watch-together/session")}${suffix} -> ${String(response.status)}`);
  }
  return securityHeaders(response);
}
export const serverOptions = {
  port: PORT, hostname: HOST, idleTimeout: 0, maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
} as const;
