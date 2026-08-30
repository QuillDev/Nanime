import { readdir, stat } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import type { LibraryStatus, MediaEntry } from "../shared/types.ts";
import { database } from "./database.ts";

export { libraryActivityResponse } from "./libraryActivity.ts";

interface MediaRow {
  readonly rel: string;
  readonly name: string;
  readonly folder: string;
  readonly size: number;
  readonly direct: number;
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
  SELECT rel, name, folder, size, direct FROM media_library ORDER BY rel
`);
const state = database.query<LibraryStateRow, []>(`
  SELECT last_scanned_at, entry_count FROM media_library_state WHERE id = 1
`);
const insert = database.query<void, [string, string, string, number, number]>(`
  INSERT INTO media_library (rel, name, folder, size, direct) VALUES (?, ?, ?, ?, ?)
`);
const replaceLibrary = database.transaction((entries: readonly MediaEntry[], scannedAt: number) => {
  database.run("DELETE FROM media_library");
  for (const entry of entries) {
    insert.run(entry.rel, entry.name, entry.folder, entry.size, entry.direct ? 1 : 0);
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

async function walk(
  directory: string,
  options: WalkOptions,
  root = false,
): Promise<void> {
  const pending = readdir(directory, { withFileTypes: true });
  const items = root ? await pending : await pending.catch(() => []);
  for (const item of items) {
    const absolutePath = join(directory, item.name);
    if (item.isDirectory() && !item.name.startsWith(".nanime-")) {
      await walk(absolutePath, options);
    } else if (item.isFile() && options.videoExtensions.has(extname(item.name).toLowerCase())) {
      const { size } = await stat(absolutePath).catch(() => ({ size: 0 }));
      const rel = relative(options.mediaDir, absolutePath);
      const folder = dirname(rel);
      options.entries.push({
        rel,
        name: item.name,
        folder: folder === "." ? "" : folder,
        size,
        direct: options.directPlayExtensions.has(extname(item.name).toLowerCase()),
      });
    }
  }
}

async function scanFiles(
  options: LibraryOptions,
): Promise<readonly MediaEntry[]> {
  const entries: MediaEntry[] = [];
  await walk(options.mediaDir, { ...options, entries }, true);
  return entries;
}

function entryFromRow(row: MediaRow): MediaEntry {
  return {
    rel: row.rel,
    name: row.name,
    folder: row.folder,
    size: row.size,
    direct: row.direct === 1,
  };
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

async function runScan(options: LibraryOptions): Promise<readonly MediaEntry[]> {
  try {
    const entries = await scanFiles(options);
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

async function refreshInBackground(options: LibraryOptions): Promise<void> {
  try {
    await refreshMediaLibrary(options);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Background library scan failed", error);
  }
}

export function listMedia(options: LibraryOptions): Promise<readonly MediaEntry[]> {
  const current = state.get();
  if (current === null) {
    return refreshMediaLibrary(options);
  }
  if (Date.now() - current.last_scanned_at >= LIBRARY_STALE_MS) {
    void refreshInBackground(options);
  }
  return Promise.resolve(cachedEntries());
}

export function libraryStatusResponse(): Response {
  return Response.json(libraryStatus());
}

export async function refreshLibraryResponse(options: LibraryOptions): Promise<Response> {
  await refreshMediaLibrary(options);
  return Response.json(libraryStatus());
}
