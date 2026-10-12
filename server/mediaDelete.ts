import { unlink } from "node:fs/promises";
import { libraryWriterResponse } from "./libraryWriterAdmission.ts";
import { forgetPlaybackProgress } from "./playback.ts";
import type { PlaybackActor } from "./playbackAudit.ts";
import { detachTorrentsForFiles } from "./torrents.ts";
import { removeTrickplayCache } from "./trickplay.ts";

const MAX_DELETE_FILES = 5000;

interface DeleteRequest {
  readonly paths?: unknown;
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
  return libraryWriterResponse({ root: mediaDir, paths: typedRels }, async (sources) => {
    const validFiles = sources.every((source, index) => {
      const rel = typedRels[index] ?? "";
      const extension = rel.slice(rel.lastIndexOf(".")).toLowerCase();
      return source.stats.isFile() && videoExtensions.has(extension);
    });
    if (!validFiles) {
      return new Response("One or more media files no longer exist", { status: 404 });
    }
    const absoluteFiles = sources.map((source) => source.abs);
    if (!(await detachTorrentsForFiles(absoluteFiles))) {
      return new Response("Could not safely remove the associated qBittorrent task", { status: 502 });
    }
    await Promise.all(absoluteFiles.map((file) => unlink(file)));
    await Promise.all(absoluteFiles.map((file) => removeTrickplayCache(file)));
    forgetPlaybackProgress(typedRels, actor);
    return Response.json({ deleted: typedRels.length });
  });
}
