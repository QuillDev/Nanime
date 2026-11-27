import { lstat, readdir, stat } from "node:fs/promises";
import type { z } from "zod";
import { dirname, extname, join, relative, sep } from "node:path";
import type { LibraryStatus, MediaEntry } from "../shared/types.ts";
import { database, db, execute, type MediaLibraryRow, MediaLibraryRowSchema, MediaLibraryStateRowSchema, queryOne, queryRows, sql } from "./database.ts";
import { entryId, hasInternalSegment, pathSegments, resolveExisting } from "./libraryPaths.ts";

export { libraryActivityResponse } from "./libraryActivity.ts";

type MediaRow = MediaLibraryRow;
const LibraryStateRowSchema = MediaLibraryStateRowSchema.pick({ last_scanned_at: true, entry_count: true });
const FolderRowSchema = MediaLibraryRowSchema.pick({ folder: true });

interface WalkOptions {
  readonly mediaDir: string;
  readonly videoExtensions: ReadonlySet<string>;
  readonly directPlayExtensions: ReadonlySet<string>;
  readonly entries: MediaEntry[];
  readonly runLimited: <T>(task: () => Promise<T>) => Promise<T>;
}

interface LibraryOptions {
  readonly mediaDir: string;
  readonly videoExtensions: ReadonlySet<string>;
  readonly directPlayExtensions: ReadonlySet<string>;
}

const LIBRARY_STALE_MS = 60_000;
const WALK_CONCURRENCY = 32;
function libraryState(): z.infer<typeof LibraryStateRowSchema> | null {
  return queryOne(db.selectFrom("media_library_state").select(["last_scanned_at", "entry_count"]).where("id", "=", 1), LibraryStateRowSchema);
}
const replaceLibrary = database.transaction((entries: readonly MediaEntry[], scannedAt: number) => {
  execute(db.deleteFrom("media_library"));
  for (const entry of entries) {
    execute(db.insertInto("media_library").values({
      rel: entry.rel, name: entry.name, folder: entry.folder, size: entry.size, direct: entry.direct ? 1 : 0, added_at: entry.addedAt ?? 0,
    }));
  }
  const state = { last_scanned_at: scannedAt, entry_count: entries.length };
  execute(db.insertInto("media_library_state").values({ id: 1, ...state })
    .onConflict((conflict) => conflict.column("id").doUpdateSet(state)));
});
let scanPromise: Promise<readonly MediaEntry[]> | undefined = undefined;
let mutationGeneration = 0;
let mutationsInFlight = 0;
let mutationsSettled = Promise.withResolvers<undefined>();

/** Marks scans that started before a library file operation as stale. */
export function noteLibraryMutation(): void {
  mutationGeneration += 1;
}

/**
 * Called before a library file operation touches the disk; the returned
 * function runs once it has committed or rolled back. Scans that overlap it
 * wait and rescan, so the cached library never stores a half-moved state.
 */
export function beginLibraryMutation(): () => void {
  mutationGeneration += 1;
  mutationsInFlight += 1;
  return () => {
    mutationGeneration += 1;
    mutationsInFlight -= 1;
    if (mutationsInFlight === 0) {
      mutationsSettled.resolve(undefined);
      mutationsSettled = Promise.withResolvers<undefined>();
    }
  };
}

/** Media lives outside Nanime's own folders (trash awaiting Undo, uploads, transcodes); scans skip those. */
export function isLibraryMediaPath(rel: string): boolean {
  return !hasInternalSegment(rel);
}

async function mutationsIdle(): Promise<void> {
  if (mutationsInFlight > 0) {
    await mutationsSettled.promise;
  }
}

function createLimiter(maxConcurrent: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: (() => void)[] = [];
  const release = (): void => {
    const next = queue.shift();
    if (next === undefined) {
      active -= 1;
    } else {
      next();
    }
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= maxConcurrent) {
      const slot = Promise.withResolvers<void>();
      queue.push(slot.resolve);
      await slot.promise;
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}

async function mediaEntryFromFile(
  absolutePath: string,
  name: string,
  options: WalkOptions,
): Promise<MediaEntry | null> {
  const stats = await options.runLimited(() => stat(absolutePath)).catch(() => null);
  if (stats === null) {
    return null;
  }
  const rel = relative(options.mediaDir, absolutePath);
  const folder = dirname(rel);
  return {
    rel,
    mediaIdentity: entryId(stats),
    name,
    folder: folder === "." ? "" : folder,
    size: stats.size,
    direct: options.directPlayExtensions.has(extname(name).toLowerCase()),
    addedAt: Math.round(stats.mtimeMs),
  };
}

async function walk(
  directory: string,
  options: WalkOptions,
  root = false,
): Promise<void> {
  const pending = options.runLimited(() => readdir(directory, { withFileTypes: true }));
  const items = root ? await pending : await pending.catch(() => []);
  const subdirectories: string[] = [];
  const videoFiles: { readonly absolutePath: string; readonly name: string }[] = [];
  for (const item of items) {
    const absolutePath = join(directory, item.name);
    if (item.isDirectory() && !item.name.startsWith(".nanime-")) {
      subdirectories.push(absolutePath);
    } else if (item.isFile() && options.videoExtensions.has(extname(item.name).toLowerCase())) {
      videoFiles.push({ absolutePath, name: item.name });
    }
  }
  const [scanned] = await Promise.all([
    Promise.all(videoFiles.map((file) => mediaEntryFromFile(file.absolutePath, file.name, options))),
    Promise.all(subdirectories.map((sub) => walk(sub, options))),
  ]);
  for (const entry of scanned) {
    if (entry !== null) {
      options.entries.push(entry);
    }
  }
}

function compareRel(left: MediaEntry, right: MediaEntry): number {
  if (left.rel < right.rel) {
    return -1;
  }
  return left.rel > right.rel ? 1 : 0;
}

async function scanFiles(
  options: LibraryOptions,
): Promise<readonly MediaEntry[]> {
  const entries: MediaEntry[] = [];
  const runLimited = createLimiter(WALK_CONCURRENCY);
  await walk(options.mediaDir, { ...options, entries, runLimited }, true);
  entries.sort(compareRel);
  return entries;
}

function entryFromRow(row: MediaRow): MediaEntry {
  const entry = {
    rel: row.rel,
    name: row.name,
    folder: row.folder,
    size: row.size,
    direct: row.direct === 1,
  } satisfies MediaEntry;
  // Rows cached before added_at existed carry 0 until the next scan.
  return row.added_at > 0 ? { ...entry, addedAt: row.added_at } : entry;
}

function cachedEntries(): readonly MediaEntry[] {
  return queryRows(db.selectFrom("media_library").selectAll().orderBy("rel"), MediaLibraryRowSchema).map((row) => entryFromRow(row));
}

export function libraryStatus(): LibraryStatus {
  const current = libraryState();
  return {
    entryCount: current?.entry_count ?? 0,
    lastScannedAt: current?.last_scanned_at ?? null,
    scanning: scanPromise !== undefined,
  };
}

/** A scan no file operation overlapped, or null when one did. */
async function settledScan(options: LibraryOptions): Promise<readonly MediaEntry[] | null> {
  await mutationsIdle();
  const generation = mutationGeneration;
  const entries = await scanFiles(options);
  return generation === mutationGeneration && mutationsInFlight === 0 ? entries : null;
}

async function runScan(options: LibraryOptions): Promise<readonly MediaEntry[]> {
  try {
    let entries = await settledScan(options);
    // A file operation ran mid-walk; rescan rather than store a mix of both.
    while (entries === null) {
      entries = await settledScan(options);
    }
    replaceLibrary(entries, Date.now());
    return entries;
  } finally {
    scanPromise = undefined;
  }
}

export function refreshMediaLibrary(options: LibraryOptions): Promise<readonly MediaEntry[]> {
  scanPromise ??= runScan(options);
  return scanPromise;
}

export async function refreshInBackground(options: LibraryOptions): Promise<void> {
  try {
    await refreshMediaLibrary(options);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Background library scan failed", error);
  }
}

/** Reads the actual occupant, never infers identity from cached size or timestamps. */
export async function mediaIdentityAt(root: string, rel: string): Promise<string | null> {
  const entry = await resolveExisting(root, rel).catch(() => null);
  return entry !== null && entry.stats.isFile() ? entryId(entry.stats) : null;
}

async function verifiedFolderAbs(root: string, folder: string): Promise<string | null> {
  if (folder === "") {
    return root;
  }
  const resolved = await resolveExisting(root, folder).catch(() => null);
  return resolved !== null && resolved.stats.isDirectory() ? resolved.abs : null;
}

async function fileIdentityInFolder(folderAbs: string, name: string): Promise<string | null> {
  try {
    const [segment] = pathSegments(name);
    if (segment === undefined || segment !== name) {
      return null;
    }
    const stats = await lstat(`${folderAbs}${sep}${segment}`).catch(() => null);
    return stats !== null && !stats.isSymbolicLink() && stats.isFile() ? entryId(stats) : null;
  } catch {
    return null;
  }
}

async function identifiedEntry(
  entry: MediaEntry,
  root: string,
  folders: Map<string, Promise<string | null>>,
): Promise<MediaEntry> {
  const expectedRel = entry.folder === "" ? entry.name : `${entry.folder}/${entry.name}`;
  if (entry.rel !== expectedRel) {
    const fallbackIdentity = await mediaIdentityAt(root, entry.rel);
    return fallbackIdentity === null ? entry : { ...entry, mediaIdentity: fallbackIdentity };
  }
  let folderPromise = folders.get(entry.folder);
  if (folderPromise === undefined) {
    folderPromise = verifiedFolderAbs(root, entry.folder);
    folders.set(entry.folder, folderPromise);
  }
  const folderAbs = await folderPromise;
  const mediaIdentity = folderAbs === null
    ? null
    : await fileIdentityInFolder(folderAbs, entry.name);
  return mediaIdentity === null ? entry : { ...entry, mediaIdentity };
}

function identifiedEntries(options: LibraryOptions): Promise<readonly MediaEntry[]> {
  const folders = new Map<string, Promise<string | null>>();
  return Promise.all(cachedEntries().map((entry) => identifiedEntry(entry, options.mediaDir, folders)));
}

export function listMedia(options: LibraryOptions): Promise<readonly MediaEntry[]> {
  const current = libraryState();
  if (current === null) {
    return refreshMediaLibrary(options);
  }
  if (Date.now() - current.last_scanned_at >= LIBRARY_STALE_MS) {
    void refreshInBackground(options);
  }
  return identifiedEntries(options);
}

/** The folders that hold videos, from the cached library (scanning first if it never ran). */
export async function listVideoFolders(options: LibraryOptions): Promise<readonly string[]> {
  if (libraryState() === null) {
    const scanned = await refreshMediaLibrary(options);
    return [...new Set(scanned.map((entry) => entry.folder))];
  }
  return queryRows(sql`SELECT folder FROM media_library GROUP BY folder ORDER BY MIN(rel)`, FolderRowSchema).map((row) => row.folder);
}

export function libraryStatusResponse(): Response {
  return Response.json(libraryStatus());
}

export async function refreshLibraryResponse(options: LibraryOptions): Promise<Response> {
  await refreshMediaLibrary(options);
  return Response.json(libraryStatus());
}
