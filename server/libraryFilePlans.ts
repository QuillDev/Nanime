import { lstat, readdir } from "node:fs/promises";
import type { Stats } from "node:fs";
import { extname, join } from "node:path";
import type { LibraryFileMovement, LibraryFileOperationKind, LibraryFileReference } from "../shared/libraryFiles.ts";
import type { JournalStep } from "./libraryJournal.ts";
import { lockAffecting, type LockState, type PathLock } from "./libraryLocks.ts";
import {
  absolutePath, baseName, childPath, hasInternalSegment, isInternalName, isSameOrInside, LibraryFileError, parentPath,
  entryId, pathIsFree, requireValidName, resolveExisting, resolveFolder, sameEntry,
} from "./libraryPaths.ts";
import type { PathMove } from "./libraryRemap.ts";
import { mediaKind, SUBTITLE_EXTENSIONS } from "./libraryTree.ts";

export const TRASH_FOLDER = ".nanime-trash";

// Temporary names that audio-track, track-pruning, and subtitle writes use beside a video.
const TEMPORARY_WRITE = /^\.nanime-subtitle-|\.nanime-(?:audio|prune)-/iu;

function isTemporaryWrite(name: string): boolean {
  return TEMPORARY_WRITE.test(name);
}

export interface PlanContext {
  readonly root: string;
  readonly videoExtensions: ReadonlySet<string>;
  readonly locks: LockState;
}

export interface OperationPlan {
  readonly kind: LibraryFileOperationKind;
  readonly steps: readonly JournalStep[];
  readonly moves: readonly PathMove[];
  readonly entries: readonly LibraryFileMovement[];
  /** Every file whose library path changes, including files inside moved folders. */
  readonly files: readonly { readonly from: string; readonly to: string }[];
  readonly revertsOperationId: string | null;
}

interface Source {
  readonly path: string;
  readonly parent: string | null;
  readonly name: string;
  readonly stats: Stats;
  readonly folder: boolean;
}

interface PreparedSource extends Source {
  readonly sidecars: readonly Sidecar[];
  /** For folders, every file inside; for files, the file itself. */
  readonly files: readonly string[];
}

interface Sidecar {
  readonly path: string;
  readonly name: string;
  readonly stats: Stats;
}

interface Movement {
  readonly from: string;
  readonly to: string;
  readonly stats: Stats;
}

function stem(name: string): string {
  const extension = extname(name);
  return extension === "" ? name : name.slice(0, -extension.length);
}

export function changedSinceLoaded(path: string): LibraryFileError {
  return new LibraryFileError(409, `“${baseName(path)}” changed since the list was loaded. Refresh and try again.`);
}

function unsupportedEntry(path: string): LibraryFileError {
  return new LibraryFileError(400, `“${path}” is not a regular file or folder (for example a pipe or socket), so Nanime doesn't manage it.`);
}

async function resolveSource(root: string, reference: LibraryFileReference): Promise<Source> {
  const { stats } = await resolveExisting(root, reference.path);
  if (!sameEntry(reference.id, stats)) {
    throw changedSinceLoaded(reference.path);
  }
  if (!stats.isFile() && !stats.isDirectory()) {
    throw unsupportedEntry(reference.path);
  }
  return {
    path: reference.path,
    parent: parentPath(reference.path),
    name: baseName(reference.path),
    stats,
    folder: stats.isDirectory(),
  };
}

/** Resolves the selection, dropping entries already covered by a selected folder. */
function resolveSources(root: string, references: readonly LibraryFileReference[]): Promise<readonly Source[]> {
  const unique = [...new Map(references.map((reference) => [reference.path, reference])).values()];
  if (unique.length === 0) {
    throw new LibraryFileError(400, "Choose at least one item.");
  }
  const topLevel = unique.filter((reference) => !unique.some((other) => other !== reference && isSameOrInside(reference.path, other.path)));
  return Promise.all(topLevel.map((reference) => resolveSource(root, reference)));
}

/**
 * Lists every file inside a folder that is about to change, refusing symbolic
 * links (which could point outside the library), special files such as pipes
 * and sockets, and Nanime's own temporary entries (which belong to an upload
 * or subtitle write still in progress).
 */
export async function inspectFolder(root: string, folder: string): Promise<readonly string[]> {
  const files: string[] = [];
  const pending = [folder];
  while (pending.length > 0) {
    const current = pending.pop() ?? folder;
    const entries = await readdir(absolutePath(root, current), { withFileTypes: true });
    for (const entry of entries) {
      const path = `${current}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new LibraryFileError(400, `“${baseName(folder)}” contains a symbolic link (“${path}”), so it can't be changed safely.`);
      }
      if (isInternalName(entry.name) || isTemporaryWrite(entry.name)) {
        throw new LibraryFileError(423, `Nanime is still writing a temporary file inside “${baseName(folder)}”. Try again shortly.`);
      }
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile()) {
        files.push(path);
      } else {
        throw unsupportedEntry(path);
      }
    }
  }
  return files;
}

function lockedError(path: string, found: PathLock): LibraryFileError {
  const subject = found.path === path ? baseName(path) : baseName(found.path);
  return new LibraryFileError(423, `“${subject}” is locked: ${found.lock.reason}`);
}

export function rejectLocked(locks: LockState, path: string): void {
  const found = lockAffecting(locks, path);
  if (found !== null) {
    throw lockedError(path, found);
  }
}

/**
 * A new name must not land in or around anything locked: a torrent still
 * writing into that folder, an upload finishing at that name, or a path an
 * interrupted operation left for recovery.
 */
export function rejectLockedDestination(locks: LockState, path: string): void {
  if (hasInternalSegment(path)) {
    return;
  }
  rejectLocked(locks, path);
}

/** Path locks only: an unreachable qBittorrent can't own a folder that doesn't exist yet. */
function rejectPathLocked(locks: LockState, path: string): void {
  const found = lockAffecting({ ...locks, global: null }, path);
  if (found !== null) {
    throw lockedError(path, found);
  }
}

/** Audio, track-pruning, and subtitle writes leave `.nanime-` temporaries next to the video. */
async function rejectWritesInProgress(context: PlanContext, source: Source): Promise<void> {
  const names = await readdir(source.parent === null ? context.root : absolutePath(context.root, source.parent));
  if (names.some((name) => isTemporaryWrite(name))) {
    throw new LibraryFileError(423, `Nanime is still writing a temporary file next to “${source.name}”. Try again shortly.`);
  }
}

/** Subtitle files that belong to a video by Nanime's sidecar naming. */
async function sidecarsOf(context: PlanContext, source: Source, selected: ReadonlySet<string>): Promise<readonly Sidecar[]> {
  if (source.folder || mediaKind(source.name, context.videoExtensions) !== "video") {
    return [];
  }
  const directory = source.parent === null ? context.root : absolutePath(context.root, source.parent);
  const names = await readdir(directory);
  const videoStems = names.flatMap((name) => (mediaKind(name, context.videoExtensions) === "video" ? [stem(name)] : []));
  const own = stem(source.name);
  const owned = names.filter((name) => {
    if (!SUBTITLE_EXTENSIONS.has(extname(name).toLowerCase()) || !name.startsWith(`${own}.`)) {
      return false;
    }
    // "Ep 1.5.en.ass" belongs to "Ep 1.5.mkv", not "Ep 1.mkv": the longest stem wins.
    return !videoStems.some((other) => other.length > own.length && name.startsWith(`${other}.`));
  });
  const candidates = await Promise.all(owned.map(async (name): Promise<Sidecar> => ({
    path: childPath(source.parent, name),
    name,
    stats: await lstat(join(directory, name)),
  })));
  return candidates.filter((sidecar) => sidecar.stats.isFile() && !selected.has(sidecar.path));
}

async function siblingNames(context: PlanContext, folder: string | null): Promise<ReadonlyMap<string, string>> {
  const names = await readdir(await resolveFolder(context.root, folder));
  return new Map(names.map((name) => [name.toLocaleLowerCase(), name]));
}

/** Case-insensitive, like the file manager, so "Season 1" and "season 1" never coexist. */
export function rejectCollisions(names: readonly string[], existing: ReadonlyMap<string, string>, vacating: ReadonlySet<string>): void {
  const incoming = new Set<string>();
  for (const name of names) {
    const key = name.toLocaleLowerCase();
    const clash = existing.get(key);
    if (incoming.has(key) || (clash !== undefined && !vacating.has(key))) {
      throw new LibraryFileError(409, `“${clash ?? name}” already exists there. Nothing was overwritten.`);
    }
    incoming.add(key);
  }
}

function stepFor(movement: Movement): JournalStep {
  return {
    kind: movement.stats.isDirectory() ? "move-folder" : "move-file",
    from: movement.from,
    to: movement.to,
    id: entryId(movement.stats),
  };
}

function fileMoves(movements: readonly Movement[], filesOf: ReadonlyMap<string, readonly string[]>): OperationPlan["files"] {
  return movements.flatMap((movement) => (filesOf.get(movement.from) ?? [movement.from]).map((from) => ({
    from,
    to: from === movement.from ? movement.to : `${movement.to}${from.slice(movement.from.length)}`,
  })));
}

async function prepareSources(context: PlanContext, references: readonly LibraryFileReference[]): Promise<readonly PreparedSource[]> {
  const sources = await resolveSources(context.root, references);
  const selected = new Set(sources.map((source) => source.path));
  const prepared: PreparedSource[] = [];
  for (const source of sources) {
    rejectLocked(context.locks, source.path);
    if (!source.folder) {
      await rejectWritesInProgress(context, source);
    }
    const files = source.folder ? await inspectFolder(context.root, source.path) : [source.path];
    const sidecars = await sidecarsOf(context, source, selected);
    for (const sidecar of sidecars) {
      rejectLocked(context.locks, sidecar.path);
    }
    prepared.push({ ...source, sidecars, files });
  }
  return prepared;
}

interface MovementPlan {
  readonly kind: LibraryFileOperationKind;
  readonly sources: readonly PreparedSource[];
  readonly movements: readonly Movement[];
}

function planFromMovements(context: PlanContext, planned: MovementPlan): Omit<OperationPlan, "entries"> {
  const { kind, sources, movements } = planned;
  for (const movement of movements) {
    rejectLockedDestination(context.locks, movement.to);
  }
  const filesOf = new Map(sources.map((source) => [source.path, source.files]));
  return {
    kind,
    steps: movements.map((movement) => stepFor(movement)),
    moves: movements.map((movement) => ({ from: movement.from, to: movement.to, folder: movement.stats.isDirectory() })),
    files: fileMoves(movements, filesOf),
    revertsOperationId: null,
  };
}

async function resolveTarget(context: PlanContext, target: LibraryFileReference | null): Promise<string | null> {
  if (target === null) {
    return null;
  }
  const folder = await resolveExisting(context.root, target.path);
  if (!sameEntry(target.id, folder.stats)) {
    throw changedSinceLoaded(target.path);
  }
  if (!folder.stats.isDirectory()) {
    throw new LibraryFileError(400, `“${baseName(target.path)}” is not a folder.`);
  }
  return target.path;
}

export async function planMove(context: PlanContext, references: readonly LibraryFileReference[], target: LibraryFileReference | null): Promise<OperationPlan> {
  const [destination, sources] = await Promise.all([resolveTarget(context, target), prepareSources(context, references)]);
  for (const source of sources) {
    if (destination !== null && isSameOrInside(destination, source.path)) {
      throw new LibraryFileError(400, `Can't move “${source.name}” into itself or one of its own folders.`);
    }
    if (source.parent === destination) {
      throw new LibraryFileError(400, `“${source.name}” is already in that folder.`);
    }
  }
  const movements = sources.flatMap((source) => [source, ...source.sidecars].map((entry): Movement => ({
    from: entry.path, to: childPath(destination, entry.name), stats: entry.stats,
  })));
  rejectCollisions(movements.map((movement) => baseName(movement.to)), await siblingNames(context, destination), new Set());
  const entries = sources.map((source) => ({ from: source.path, to: childPath(destination, source.name) }));
  return { ...planFromMovements(context, { kind: "move", sources, movements }), entries };
}

export async function planRename(context: PlanContext, reference: LibraryFileReference, name: string): Promise<OperationPlan> {
  requireValidName(name);
  const [source] = await prepareSources(context, [reference]);
  if (source === undefined) {
    throw new LibraryFileError(400, "Choose an item to rename.");
  }
  if (!source.folder && extname(source.name).toLowerCase() !== extname(name).toLowerCase()) {
    throw new LibraryFileError(400, extname(source.name) === "" ? "Renaming can't add a file extension." : `Keep the ${extname(source.name)} extension.`);
  }
  if (name === source.name) {
    throw new LibraryFileError(400, "That is already its name.");
  }
  const oldStem = stem(source.name);
  const newStem = stem(name);
  const movements: Movement[] = [
    { from: source.path, to: childPath(source.parent, name), stats: source.stats },
    ...source.sidecars.map((sidecar) => ({
      from: sidecar.path,
      to: childPath(source.parent, `${newStem}${sidecar.name.slice(oldStem.length)}`),
      stats: sidecar.stats,
    })),
  ];
  const vacating = new Set(movements.map((movement) => baseName(movement.from).toLocaleLowerCase()));
  rejectCollisions(movements.map((movement) => baseName(movement.to)), await siblingNames(context, source.parent), vacating);
  return { ...planFromMovements(context, { kind: "rename", sources: [source], movements }), entries: [{ from: source.path, to: childPath(source.parent, name) }] };
}

/** The trash must be a real folder directly in the library, never a link out of it. */
async function trashIsMissing(root: string): Promise<boolean> {
  const stats = await lstat(absolutePath(root, TRASH_FOLDER)).catch((): null => null);
  if (stats === null) {
    return true;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new LibraryFileError(500, "Nanime's trash folder is not a real folder inside the library, so nothing can be moved to it safely.");
  }
  return false;
}

export async function planTrash(context: PlanContext, references: readonly LibraryFileReference[], operationId: string): Promise<OperationPlan> {
  const sources = await prepareSources(context, references);
  const bin = `${TRASH_FOLDER}/${operationId}`;
  const trashMissing = await trashIsMissing(context.root);
  const steps: JournalStep[] = trashMissing ? [{ kind: "mkdir", from: null, to: TRASH_FOLDER }] : [];
  steps.push({ kind: "mkdir", from: null, to: bin });
  const movements: Movement[] = [];
  const topLevel: LibraryFileMovement[] = [];
  for (const [index, source] of sources.entries()) {
    const slot = `${bin}/${String(index + 1)}`;
    steps.push({ kind: "mkdir", from: null, to: slot });
    const moved = [source, ...source.sidecars].map((entry): Movement => ({ from: entry.path, to: `${slot}/${entry.name}`, stats: entry.stats }));
    steps.push(...moved.map((movement) => stepFor(movement)));
    movements.push(...moved);
    topLevel.push({ from: source.path, to: `${slot}/${source.name}` });
  }
  return { ...planFromMovements(context, { kind: "trash", sources, movements }), steps, entries: topLevel };
}

export async function planCreateFolder(context: PlanContext, parent: LibraryFileReference | null, name: string): Promise<OperationPlan> {
  requireValidName(name);
  const folder = await resolveTarget(context, parent);
  rejectCollisions([name], await siblingNames(context, folder), new Set());
  const path = childPath(folder, name);
  rejectPathLocked(context.locks, path);
  if (!await pathIsFree(absolutePath(context.root, path))) {
    throw new LibraryFileError(409, `“${name}” already exists there.`);
  }
  return {
    kind: "create-folder",
    steps: [{ kind: "mkdir", from: null, to: path }],
    moves: [],
    entries: [{ from: null, to: path }],
    files: [],
    revertsOperationId: null,
  };
}
