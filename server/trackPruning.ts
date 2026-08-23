import { randomUUID } from "node:crypto";
import { chmod, lstat, realpath, rename, unlink } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { audioTracks, invalidateAudioTracks } from "./audioTracks.ts";
import {
  invalidateSubtitleTracks,
  sidecarSubtitlePaths,
  subtitleTracks,
} from "./subtitles.ts";
import { detachTorrentsForFiles } from "./torrents.ts";
import { invalidateMediaScan } from "./scanCache.ts";
import type { MediaLibraryOptions } from "./mediaLibraryOptions.ts";

interface PruneOperationBody {
  readonly path?: unknown;
  readonly audioIndices?: unknown;
  readonly subtitleIndices?: unknown;
}

interface PruneBody {
  readonly operations?: unknown;
}

interface PruneOperation {
  readonly path: string;
  readonly abs: string;
  readonly audioIndices: readonly number[];
  readonly subtitleIndices: readonly number[];
  readonly sidecars: readonly string[];
}

function validIndices(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.length <= 100 &&
    value.every((index) => typeof index === "number" && Number.isInteger(index));
}

async function safeMedia(path: string, options: MediaLibraryOptions): Promise<string | null> {
  const candidate = resolve(options.mediaDir, path);
  if (
    candidate === options.mediaDir || !candidate.startsWith(options.mediaDir + sep) ||
    !options.videoExtensions.has(extname(candidate).toLowerCase())
  ) {
    return null;
  }
  const canonical = await realpath(candidate).catch(() => null);
  return canonical !== null && canonical.startsWith(options.mediaRoot + sep) ? canonical : null;
}

async function prepareOperation(
  value: PruneOperationBody,
  options: MediaLibraryOptions,
): Promise<PruneOperation | null> {
  if (
    typeof value.path !== "string" || value.path === "" ||
    !validIndices(value.audioIndices) || !validIndices(value.subtitleIndices)
  ) {
    return null;
  }
  const abs = await safeMedia(value.path, options);
  if (abs === null) {
    return null;
  }
  const audioIndices = [...new Set(value.audioIndices)];
  const subtitleIndices = [...new Set(value.subtitleIndices)];
  const [audio, subtitles] = await Promise.all([audioTracks(abs), subtitleTracks(abs)]);
  if (
    audioIndices.some((index) => !audio.some((track) => track.index === index)) ||
    subtitleIndices.some((index) => !subtitles.some((track) => track.index === index)) ||
    audio.length - audioIndices.length < 1
  ) {
    return null;
  }
  const sidecars = await sidecarSubtitlePaths(abs, new Set(subtitleIndices));
  return { path: value.path, abs, audioIndices, subtitleIndices, sidecars };
}

async function remux(operation: PruneOperation, temporary: string): Promise<boolean> {
  const embeddedSubtitles = operation.subtitleIndices.filter((index) => index >= 0);
  const exclusions = [...operation.audioIndices, ...embeddedSubtitles]
    .flatMap((index) => ["-map", `-0:${String(index)}`]);
  const proc = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error",
    "-i", operation.abs, "-map", "0", ...exclusions,
    "-map_metadata", "0", "-map_chapters", "0", "-c", "copy", temporary,
  ], { stdout: "ignore", stderr: "ignore" });
  return await proc.exited === 0;
}

async function rollbackSidecars(moved: readonly (readonly [string, string])[]): Promise<void> {
  await Promise.all(moved.map(([original, temporary]) => (
    rename(temporary, original).catch(() => undefined)
  )));
}

async function applyOperation(operation: PruneOperation): Promise<boolean> {
  const embedded = operation.audioIndices.length > 0 ||
    operation.subtitleIndices.some((index) => index >= 0);
  const extension = extname(operation.abs);
  const temporary = `${operation.abs}.nanime-prune-${randomUUID()}${extension}`;
  const movedSidecars = operation.sidecars.map((path) => (
    [path, `${path}.nanime-prune-${randomUUID()}`] as const
  ));
  try {
    if (embedded && !(await remux(operation, temporary))) {
      return false;
    }
    if (!(await detachTorrentsForFiles([operation.abs, ...operation.sidecars]))) {
      return false;
    }
    for (const [original, moved] of movedSidecars) {
      await rename(original, moved);
    }
    if (embedded) {
      const [original, output] = await Promise.all([lstat(operation.abs), lstat(temporary)]);
      if (!output.isFile() || output.size <= 0) {
        await rollbackSidecars(movedSidecars);
        return false;
      }
      await chmod(temporary, original.mode);
      await rename(temporary, operation.abs);
    }
    await Promise.all(movedSidecars.map(([, moved]) => unlink(moved)));
    invalidateAudioTracks(operation.abs);
    invalidateSubtitleTracks(operation.abs);
    invalidateMediaScan(operation.path);
    return true;
  } catch {
    await rollbackSidecars(movedSidecars);
    return false;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function pruneTracksResponse(req: Request, options: MediaLibraryOptions): Promise<Response> {
  const body = (await req.json().catch(() => null)) as PruneBody | null;
  if (!Array.isArray(body?.operations) || body.operations.length === 0 || body.operations.length > 100) {
    return new Response("Choose tracks from up to 100 videos", { status: 400 });
  }
  const values = body.operations as PruneOperationBody[];
  const operations = await Promise.all(values.map((value) => prepareOperation(value, options)));
  if (
    operations.some((operation) => operation === null) ||
    new Set(values.map((value) => value.path)).size !== values.length
  ) {
    return new Response("One or more track selections are invalid", { status: 400 });
  }
  let processed = 0;
  for (const operation of operations as PruneOperation[]) {
    if (!(await applyOperation(operation))) {
      return new Response(`Track pruning stopped after ${String(processed)} videos`, { status: 500 });
    }
    processed += 1;
  }
  return Response.json({ processed });
}
