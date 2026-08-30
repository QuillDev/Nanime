import { realpath, statfs } from "node:fs/promises";
import { dirname } from "node:path";
import { deleteAudioTrackResponse } from "./audioTracks.ts";
import { deleteMediaResponse } from "./mediaDelete.ts";
import { mediaUploadResponse } from "./mediaUpload.ts";
import { invalidateSubtitleTracks, subtitleUploadResponse } from "./subtitles.ts";
import { transcodeResponse } from "./transcodes.ts";
import { pruneTracksResponse } from "./trackPruning.ts";
import { mediaScanResponse } from "./mediaScans.ts";
import { fileSystemErrorCode } from "./fileSystemError.ts";

interface MediaAdminOptions {
  readonly isAdmin: boolean;
  readonly userId: number;
  readonly username: string;
  readonly mediaDir: string;
  readonly mediaRoot: string;
  readonly videoExtensions: ReadonlySet<string>;
}

const ADMIN_ROUTE_KEYS = new Set([
  "DELETE /api/audio-tracks",
  "GET /api/media/scans",
  "GET /api/storage",
  "POST /api/media/delete",
  "POST /api/media/prune-tracks",
  "POST /api/media/scans",
  "POST /api/subtitles",
]);

async function storageResponse(mediaRoot: string): Promise<Response> {
  const canonicalRoot = await realpath(mediaRoot).catch(() => null);
  if (canonicalRoot === null) {
    return new Response("Storage status unavailable", { status: 503 });
  }
  let candidate = canonicalRoot;
  while (true) {
    try {
      const fileSystem = await statfs(candidate, { bigint: true });
      return Response.json({
        totalBytes: Number(fileSystem.blocks * fileSystem.bsize),
        availableBytes: Number(fileSystem.bavail * fileSystem.bsize),
      });
    } catch (error) {
      const parent = dirname(candidate);
      const errorCode = fileSystemErrorCode(error);
      if (errorCode !== "ENOENT" || parent === candidate) {
        return new Response("Storage status unavailable", { status: 503 });
      }
      candidate = parent;
    }
  }
}

export function mediaAdminResponse(
  req: Request,
  pathname: string,
  options: MediaAdminOptions,
): Response | Promise<Response> | null {
  if (!isMediaAdminRoute(req.method, pathname)) {
    return null;
  }
  if (!options.isAdmin) {
    return new Response("Forbidden", { status: 403 });
  }
  return dispatchMediaAdmin(req, pathname, options);
}

function isMediaAdminRoute(method: string, pathname: string): boolean {
  return ADMIN_ROUTE_KEYS.has(`${method} ${pathname}`) || pathname === "/api/media/uploads" ||
    pathname.startsWith("/api/media/uploads/") || pathname === "/api/transcodes" ||
    pathname.startsWith("/api/transcodes/");
}

function dispatchCoreMediaAdmin(
  req: Request,
  pathname: string,
  options: MediaAdminOptions,
): Response | Promise<Response> | null {
  if (pathname === "/api/storage" && req.method === "GET") {
    return storageResponse(options.mediaRoot);
  }
  if (pathname === "/api/media/delete") {
    return deleteMediaResponse(req, {
      mediaDir: options.mediaDir,
      videoExtensions: options.videoExtensions,
      actor: { id: options.userId, username: options.username },
    });
  }
  if (pathname === "/api/audio-tracks" && req.method === "DELETE") {
    return deleteAudioTrackResponse(req, { ...options, invalidateSubtitles: invalidateSubtitleTracks });
  }
  if (pathname === "/api/media/prune-tracks" && req.method === "POST") {
    return pruneTracksResponse(req, options);
  }
  if (pathname === "/api/media/scans" && (req.method === "GET" || req.method === "POST")) {
    return mediaScanResponse(req, options);
  }
  return null;
}

function dispatchMediaAdmin(
  req: Request,
  pathname: string,
  options: MediaAdminOptions,
): Response | Promise<Response> {
  const core = dispatchCoreMediaAdmin(req, pathname, options);
  if (core !== null) {
    return core;
  }
  if (pathname === "/api/media/uploads" || pathname.startsWith("/api/media/uploads/")) {
    return mediaUploadResponse(req, pathname, options);
  }
  if (pathname === "/api/subtitles" && req.method === "POST") {
    return subtitleUploadResponse(req, options.mediaRoot, options.videoExtensions);
  }
  if (pathname === "/api/transcodes" || pathname.startsWith("/api/transcodes/")) {
    return transcodeResponse(req, pathname, options);
  }
  return new Response("Method not allowed", { status: 405 });
}
