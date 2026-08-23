import { realpath, statfs } from "node:fs/promises";
import { dirname } from "node:path";
import { deleteAudioTrackResponse } from "./audioTracks.ts";
import { deleteMediaResponse } from "./mediaDelete.ts";
import { mediaUploadResponse } from "./mediaUpload.ts";
import { invalidateSubtitleTracks, subtitleUploadResponse } from "./subtitles.ts";
import { transcodeResponse } from "./transcodes.ts";
import { pruneTracksResponse } from "./trackPruning.ts";
import { mediaScanResponse } from "./mediaScans.ts";

interface MediaAdminOptions {
  readonly isAdmin: boolean;
  readonly userId: number;
  readonly mediaDir: string;
  readonly mediaRoot: string;
  readonly videoExtensions: ReadonlySet<string>;
}

export async function storageResponse(mediaRoot: string): Promise<Response> {
  // eslint-disable-next-line no-inline-comments, capitalized-comments -- CodeQL syntax is fixed.
  const canonicalRoot = await realpath(mediaRoot).catch(() => null); // lgtm[js/path-injection]
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
      const errorCode = typeof error === "object" && error !== null
        ? Reflect.get(error, "code")
        : null;
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
  if (pathname === "/api/storage" && req.method === "GET") {
    return options.isAdmin
      ? storageResponse(options.mediaRoot)
      : new Response("Forbidden", { status: 403 });
  }
  if (pathname === "/api/media/delete") {
    return options.isAdmin
      ? deleteMediaResponse(req, options.mediaDir, options.videoExtensions)
      : new Response("Forbidden", { status: 403 });
  }
  if (pathname === "/api/audio-tracks" && req.method === "DELETE") {
    return options.isAdmin
      ? deleteAudioTrackResponse(req, { ...options, invalidateSubtitles: invalidateSubtitleTracks })
      : new Response("Forbidden", { status: 403 });
  }
  if (pathname === "/api/media/prune-tracks" && req.method === "POST") {
    return options.isAdmin
      ? pruneTracksResponse(req, options)
      : new Response("Forbidden", { status: 403 });
  }
  if (pathname === "/api/media/scans" && (req.method === "GET" || req.method === "POST")) {
    return options.isAdmin
      ? mediaScanResponse(req, options)
      : new Response("Forbidden", { status: 403 });
  }
  if (pathname === "/api/media/uploads" || pathname.startsWith("/api/media/uploads/")) {
    return options.isAdmin
      ? mediaUploadResponse(req, pathname, options)
      : new Response("Forbidden", { status: 403 });
  }
  if (pathname === "/api/subtitles" && req.method === "POST") {
    return options.isAdmin
      ? subtitleUploadResponse(req, options.mediaRoot, options.videoExtensions)
      : new Response("Forbidden", { status: 403 });
  }
  if (pathname === "/api/transcodes" || pathname.startsWith("/api/transcodes/")) {
    return options.isAdmin
      ? transcodeResponse(req, pathname, options)
      : new Response("Forbidden", { status: 403 });
  }
  return null;
}
