import { lstat, unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { forgetPlaybackProgress } from "./playback.ts";
import type { PlaybackActor } from "./playbackAudit.ts";
import { detachTorrentsForFiles } from "./torrents.ts";
import { removeTrickplayCache } from "./trickplay.ts";

const MAX_DELETE_FILES = 5000;

interface DeleteRequest {
  readonly paths?: unknown;
}

function mediaPath(mediaDir: string, rel: string): string | null {
  const abs = resolve(mediaDir, rel);
  return abs !== mediaDir && abs.startsWith(mediaDir + sep) ? abs : null;
}

export async function deleteMediaResponse(
  req: Request,
  options: {
    readonly mediaDir: string;
    readonly videoExtensions: ReadonlySet<string>;
    readonly actor: PlaybackActor;
  },
): Promise<Response> {
  const { mediaDir, videoExtensions, actor } = options;
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const body = (await req.json().catch(() => null)) as DeleteRequest | null;
  if (body === null || !Array.isArray(body.paths)) {
    return new Response("Choose media to delete", { status: 400 });
  }
  const rels = [...new Set(body.paths)];
  if (
    rels.length === 0 ||
    rels.length > MAX_DELETE_FILES ||
    rels.some((rel) => typeof rel !== "string" || rel === "")
  ) {
    return new Response("Invalid media selection", { status: 400 });
  }
  const typedRels = rels as string[];
  const files = typedRels.map((rel) => mediaPath(mediaDir, rel));
  if (files.some((file) => file === null)) {
    return new Response("Invalid media path", { status: 400 });
  }
  const absoluteFiles = files as string[];
  const fileStats = await Promise.all(absoluteFiles.map((file) => lstat(file).catch(() => null)));
  const validFiles = fileStats.every((fileStat, index) => {
    const rel = typedRels[index] ?? "";
    const extension = rel.slice(rel.lastIndexOf(".")).toLowerCase();
    return fileStat?.isFile() === true && videoExtensions.has(extension);
  });
  if (!validFiles) {
    return new Response("One or more media files no longer exist", { status: 404 });
  }
  if (!(await detachTorrentsForFiles(absoluteFiles))) {
    return new Response("Could not safely remove the associated qBittorrent task", { status: 502 });
  }
  await Promise.all(absoluteFiles.map((file) => unlink(file)));
  await Promise.all(absoluteFiles.map((file) => removeTrickplayCache(file)));
  forgetPlaybackProgress(typedRels, actor);
  return Response.json({ deleted: typedRels.length });
}
