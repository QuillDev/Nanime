import { lstat, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import type { LibraryStatus, MediaEntry } from "../shared/types.ts";
import { database } from "./database.ts";
import { entryId, hasInternalSegment, pathSegments, resolveExisting } from "./libraryPaths.ts";

export { libraryActivityResponse } from "./libraryActivity.ts";

interface MediaRow {
  readonly rel: string;
  readonly name: string;
  readonly folder: string;
  readonly size: number;
  readonly direct: number;
  readonly added_at: number;
}

interface LibraryStateRow {
  readonly last_scanned_at: number;
  readonly entry_count: number;
}

interface WalkOptions {
  readonly mediaDir: string;
  readonly videoExtensions: ReadonlySet<string>;
  readonly directPlayExtensions: ReadonlySet<string>;
  readonly entries: MediaEntry[];
}

interface LibraryOptions {
  readonly mediaDir: string;
  readonly videoExtensions: ReadonlySet<string>;
  readonly directPlayExtensions: ReadonlySet<string>;
}

const LIBRARY_STALE_MS = 60_000;
const rows = database.query<MediaRow, []>(`
  SELECT rel, name, folder, size, direct, added_at FROM media_library ORDER BY rel
`);
const distinctFolders = database.query<{ readonly folder: string }, []>(`
  SELECT DISTINCT folder FROM media_library
`);
const state = database.query<LibraryStateRow, []>(`
  SELECT last_scanned_at, entry_count FROM media_library_state WHERE id = 1
`);
const insert = database.query<void, [string, string, string, number, number, number]>(`
  INSERT INTO media_library (rel, name, folder, size, direct, added_at) VALUES (?, ?, ?, ?, ?, ?)
`);
const replaceLibrary = database.transaction((entries: readonly MediaEntry[], scannedAt: number) => {
  database.run("DELETE FROM media_library");
  for (const entry of entries) {
    insert.run(entry.rel, entry.name, entry.folder, entry.size, entry.direct ? 1 : 0, entry.addedAt ?? 0);
  }
  database.query<void, [number, number]>(`
    INSERT INTO media_library_state (id, last_scanned_at, entry_count)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_scanned_at = excluded.last_scanned_at,
      entry_count = excluded.entry_count
  `).run(scannedAt, entries.length);
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

async function mediaEntryFromFile(
  absolutePath: string,
  name: string,
  options: WalkOptions,
): Promise<MediaEntry | null> {
  const stats = await stat(absolutePath).catch(() => null);
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
  const pending = readdir(directory, { withFileTypes: true });
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
  await walk(options.mediaDir, { ...options, entries }, true);
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
  return rows.all().map((row) => entryFromRow(row));
}

export function libraryStatus(): LibraryStatus {
  const current = state.get();
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
  const current = state.get();
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
  if (state.get() === null) {
    const scanned = await refreshMediaLibrary(options);
    return [...new Set(scanned.map((entry) => entry.folder))];
  }
  return distinctFolders.all().map((row) => row.folder);
}

export function libraryStatusResponse(): Response {
  return Response.json(libraryStatus());
}

export async function refreshLibraryResponse(options: LibraryOptions): Promise<Response> {
  await refreshMediaLibrary(options);
  return Response.json(libraryStatus());
}
