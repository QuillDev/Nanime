import type { LibraryFileItem, LibraryFileReference } from "../shared/libraryFiles.ts";
import { readFolderMetadata, writeFolderMatches } from "./folderMetadata.ts";
import type { ActivityActor } from "./libraryActivity.ts";
import { listLibraryFiles, performLibraryFileOperation, type LibraryFileContext, type LibraryFileRequest } from "./libraryFileOperations.ts";
import { absolutePath, baseName, childPath, isSameOrInside, LibraryFileError, parentPath, pathSegments, requireValidName } from "./libraryPaths.ts";
import { detachTorrentsForFiles, torrentOwnership } from "./torrents.ts";

const MAX_EPISODES = 500;

/**
 * Organizes one season folder: renames episodes, renames the folder, and nests
 * a top-level release folder inside its show's folder. Every step is an
 * ordinary journaled file operation, so progress, transcodes, subtitles and
 * the folder's `nanime.json` follow and each step can be undone.
 */
export interface EpisodeNamesRequest {
  readonly folder: string;
  readonly showFolder: string | null;
  readonly seasonFolder: string | null;
  readonly episodes: readonly EpisodeName[];
}

export interface EpisodeName {
  readonly rel: string;
  readonly name: string;
}

/** The request body before validation; Elysia has already checked its shape. */
interface EpisodeNamesBody {
  readonly folder?: unknown;
  readonly showFolder?: unknown;
  readonly seasonFolder?: unknown;
  readonly episodes?: unknown;
}

interface EpisodeNameBody {
  readonly rel?: unknown;
  readonly name?: unknown;
}

export interface EpisodeNamesResult {
  /** Where the season's episodes live now. */
  readonly folder: string;
  /** Whether a qBittorrent torrent was removed (files kept) so its files could be renamed. */
  readonly stoppedSeeding: boolean;
}

interface Call {
  readonly context: LibraryFileContext;
  readonly actor: ActivityActor;
}

function stringField(value: unknown, message: string): string {
  if (typeof value !== "string" || value === "") {
    throw new LibraryFileError(400, message);
  }
  return value;
}

function optionalName(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const name = stringField(value, "Enter a folder name.");
  requireValidName(name);
  return name;
}

function episodeField(value: unknown, folder: string): EpisodeName {
  const item: EpisodeNameBody = typeof value === "object" && value !== null ? value : {};
  const rel = stringField(item.rel, "Choose episodes from the season.");
  const name = stringField(item.name, "Enter an episode name.");
  requireValidName(name);
  if (parentPath(rel) !== folder) {
    throw new LibraryFileError(400, "Every episode must be in the season's folder.");
  }
  return { rel, name };
}

export function episodeNamesRequest(value: unknown): EpisodeNamesRequest {
  const body: EpisodeNamesBody = typeof value === "object" && value !== null ? value : {};
  const folder = pathSegments(stringField(body.folder, "Choose a season folder.")).join("/");
  const episodes: readonly unknown[] = Array.isArray(body.episodes) ? body.episodes : [];
  if (episodes.length > MAX_EPISODES) {
    throw new LibraryFileError(400, `Rename at most ${String(MAX_EPISODES)} episodes at once.`);
  }
  const showFolder = optionalName(body.showFolder);
  if (showFolder !== null && parentPath(folder) !== null) {
    throw new LibraryFileError(400, "Only a top-level folder can move into a show folder.");
  }
  return { folder, showFolder, seasonFolder: optionalName(body.seasonFolder), episodes: episodes.map((item) => episodeField(item, folder)) };
}

async function snapshotItems(context: LibraryFileContext): Promise<ReadonlyMap<string, LibraryFileItem>> {
  const snapshot = await listLibraryFiles(context);
  return new Map(snapshot.items.map((item) => [item.path, item]));
}

function referenceAt(items: ReadonlyMap<string, LibraryFileItem>, path: string): LibraryFileReference {
  const item = items.get(path);
  if (item === undefined) {
    throw new LibraryFileError(409, `“${path}” is no longer in the library. Refresh and try again.`);
  }
  return { path, id: item.id };
}

async function perform(call: Call, request: (items: ReadonlyMap<string, LibraryFileItem>) => LibraryFileRequest): Promise<void> {
  const items = await snapshotItems(call.context);
  await performLibraryFileOperation({ context: call.context, request: request(items), actor: call.actor });
}

/**
 * Renaming a seeding torrent's files breaks it, so the torrent is removed from
 * qBittorrent first (its files stay). Re-reading ownership afterwards drops
 * Nanime's own claim on the payload.
 */
async function stopSeeding(call: Call, folder: string): Promise<boolean> {
  const items = await snapshotItems(call.context);
  const seeding = [...items.values()].filter((item) => isSameOrInside(item.path, folder) && item.lock?.source === "torrent");
  if (seeding.length === 0) {
    return false;
  }
  if (seeding.some((item) => item.lock?.tone === "busy")) {
    throw new LibraryFileError(423, "This season is still downloading. Wait until it finishes.");
  }
  if (!(await detachTorrentsForFiles(seeding.map((item) => absolutePath(call.context.root, item.path))))) {
    throw new LibraryFileError(502, "qBittorrent didn't stop seeding this season, so nothing was renamed.");
  }
  await torrentOwnership();
  return true;
}

/** One journaled rename per episode, in order (library writes run one at a time anyway). */
async function renameEpisodes(call: Call, episodes: readonly EpisodeName[]): Promise<void> {
  const [episode, ...rest] = episodes;
  if (episode === undefined) {
    return;
  }
  if (baseName(episode.rel) !== episode.name) {
    await perform(call, (items) => ({ type: "rename", item: referenceAt(items, episode.rel), name: episode.name }));
  }
  await renameEpisodes(call, rest);
}

/** Moves a top-level folder into the show folder, creating it and carrying the show match up. */
async function nestInShow(call: Call, folder: string, showFolder: string): Promise<string> {
  const before = await snapshotItems(call.context);
  if (!before.has(showFolder)) {
    await perform(call, () => ({ type: "create-folder", parent: null, name: showFolder }));
  }
  await perform(call, (items) => ({ type: "move", items: [referenceAt(items, folder)], target: referenceAt(items, showFolder) }));
  const nested = childPath(showFolder, baseName(folder));
  // `show` is only read from top-level folders, so the match moves up with the season.
  const showMatch = readFolderMetadata(call.context.root, nested).show;
  if (showMatch !== undefined && readFolderMetadata(call.context.root, showFolder).show === undefined) {
    writeFolderMatches(call.context.root, [{ folder: showFolder, role: "show", match: showMatch }]);
  }
  return nested;
}

export async function applyEpisodeNames(call: Call, request: EpisodeNamesRequest): Promise<EpisodeNamesResult> {
  const stoppedSeeding = await stopSeeding(call, request.folder);
  await renameEpisodes(call, request.episodes);
  const { showFolder, seasonFolder } = request;
  let { folder } = request;
  if (showFolder !== null && showFolder !== folder) {
    folder = await nestInShow(call, folder, showFolder);
  }
  if (seasonFolder !== null && seasonFolder !== baseName(folder)) {
    const current = folder;
    await perform(call, (items) => ({ type: "rename", item: referenceAt(items, current), name: seasonFolder }));
    folder = childPath(parentPath(folder), seasonFolder);
  }
  return { folder, stoppedSeeding };
}

export async function episodeNamesResponse(req: Request, call: Call): Promise<Response> {
  try {
    const request = episodeNamesRequest(await req.json().catch((): null => null));
    return Response.json(await applyEpisodeNames(call, request), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof LibraryFileError) {
      return Response.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
