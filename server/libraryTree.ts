import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import type { Stats } from "node:fs";
import { extname, join } from "node:path";
import type { LibraryFileItem, LibraryFileLock, LibraryFileMedia, LibraryFilesSnapshot } from "../shared/libraryFiles.ts";
import { entryLock, type LockState } from "./libraryLocks.ts";
import { childPath, entryId, isInternalName } from "./libraryPaths.ts";

export const SUBTITLE_EXTENSIONS: ReadonlySet<string> = new Set([".ass", ".idx", ".srt", ".ssa", ".sub", ".sup", ".vtt"]);

const SYMLINK_LOCK: LibraryFileLock = {
  source: "symlink",
  reason: "Symbolic links are managed outside Nanime.",
  tone: "locked",
};

export interface WalkedEntry {
  readonly path: string;
  readonly parent: string | null;
  readonly name: string;
  readonly stats: Stats;
}

async function walkDirectory(root: string, parent: string | null, out: WalkedEntry[]): Promise<void> {
  const directory = parent === null ? root : join(root, ...parent.split("/"));
  const names = await readdir(directory).catch((): string[] => []);
  for (const name of names.toSorted()) {
    if (isInternalName(name)) {
      continue;
    }
    const path = childPath(parent, name);
    const stats = await lstat(join(directory, name)).catch((): null => null);
    if (stats !== null) {
      out.push({ path, parent, name, stats });
      if (stats.isDirectory()) {
        await walkDirectory(root, path, out);
      }
    }
  }
}

/** Every entry under `folder` (or the whole library), skipping Nanime's internal folders. */
export async function walkLibrary(root: string, folder: string | null = null): Promise<readonly WalkedEntry[]> {
  const out: WalkedEntry[] = [];
  await walkDirectory(root, folder, out);
  return out;
}

export function mediaKind(name: string, videoExtensions: ReadonlySet<string>): LibraryFileMedia {
  const extension = extname(name).toLowerCase();
  if (videoExtensions.has(extension)) {
    return "video";
  }
  return SUBTITLE_EXTENSIONS.has(extension) ? "subtitle" : "other";
}

function uniqueIds(entries: readonly WalkedEntry[]): ReadonlyMap<string, string> {
  const ids = new Map<string, string>();
  const used = new Set<string>();
  for (const entry of entries) {
    const base = entryId(entry.stats);
    // Hard links share an inode; give later names a distinct, still-verifiable id.
    const id = used.has(base) ? `${base}~${createHash("sha256").update(entry.path).digest("hex").slice(0, 8)}` : base;
    used.add(id);
    ids.set(entry.path, id);
  }
  return ids;
}

interface ItemContext {
  readonly ids: ReadonlyMap<string, string>;
  readonly locks: LockState;
  readonly videoExtensions: ReadonlySet<string>;
}

function itemFor(entry: WalkedEntry, context: ItemContext): LibraryFileItem {
  const { ids, locks, videoExtensions } = context;
  const symlink = entry.stats.isSymbolicLink();
  const folder = entry.stats.isDirectory();
  return {
    id: ids.get(entry.path) ?? entryId(entry.stats),
    parentId: entry.parent === null ? null : ids.get(entry.parent) ?? null,
    path: entry.path,
    name: entry.name,
    kind: folder ? "folder" : "file",
    media: folder || symlink ? null : mediaKind(entry.name, videoExtensions),
    size: folder ? null : entry.stats.size,
    modifiedAt: Math.trunc(entry.stats.mtimeMs),
    lock: symlink ? SYMLINK_LOCK : entryLock(locks, entry.path),
  };
}

export function librarySnapshot(entries: readonly WalkedEntry[], locks: LockState, videoExtensions: ReadonlySet<string>): LibraryFilesSnapshot {
  const ids = uniqueIds(entries);
  return {
    items: entries.map((entry) => itemFor(entry, { ids, locks, videoExtensions })),
    torrentOwnership: locks.ownership,
    generatedAt: Date.now(),
  };
}
