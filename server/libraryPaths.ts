import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { join, sep } from "node:path";

const RESERVED_PREFIX = ".nanime-";
const FORBIDDEN_NAME = /[\\/:*?"<>|\p{Cc}]/u;
const MAX_NAME_LENGTH = 255;
const MAX_PATH_LENGTH = 4096;

export class LibraryFileError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LibraryFileError";
    this.status = status;
  }
}

export function isInternalName(name: string): boolean {
  return name.toLowerCase().startsWith(RESERVED_PREFIX);
}

/** True for paths inside Nanime's own folders, such as trashed media awaiting Undo. */
export function hasInternalSegment(path: string): boolean {
  return path.split(/[\\/]/u).some((segment) => isInternalName(segment));
}

/** Mirrors the file manager's client rules and adds Nanime's reserved prefix. */
export function nameProblem(name: string): string | null {
  if (name.trim() === "") {
    return "Name can't be empty.";
  }
  if (name !== name.trim()) {
    return "Name can't start or end with a space.";
  }
  if (name === "." || name === ".." || name.endsWith(".")) {
    return "Name can't be “.” or “..” or end with a dot.";
  }
  if (FORBIDDEN_NAME.test(name)) {
    return "Name can't contain slashes, control characters, or any of : * ? \" < > |.";
  }
  if (new TextEncoder().encode(name).length > MAX_NAME_LENGTH) {
    return "Name is longer than 255 bytes.";
  }
  return isInternalName(name) ? "Names starting with “.nanime-” are reserved for Nanime." : null;
}

export function requireValidName(name: string): void {
  const problem = nameProblem(name);
  if (problem !== null) {
    throw new LibraryFileError(400, problem);
  }
}

/**
 * Splits a client path into segments. Absolute paths, `.`/`..`, empty
 * segments, backslashes, and Nanime's internal folders are rejected before any
 * filesystem access.
 */
export function pathSegments(path: string): readonly string[] {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH || path.startsWith("/") || path.includes("\\")) {
    throw new LibraryFileError(400, "That path is outside the library.");
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === ".." || FORBIDDEN_NAME.test(segment)) {
      throw new LibraryFileError(400, "That path is outside the library.");
    }
    if (isInternalName(segment)) {
      throw new LibraryFileError(400, "Nanime's internal folders can't be managed here.");
    }
  }
  return segments;
}

export function parentPath(path: string): string | null {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? null : path.slice(0, slash);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function childPath(parent: string | null, name: string): string {
  return parent === null ? name : `${parent}/${name}`;
}

export function absolutePath(root: string, path: string): string {
  return join(root, ...path.split("/"));
}

/** True when `path` is `ancestor` itself or lies inside it. */
export function isSameOrInside(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

export function entryId(stats: Pick<Stats, "dev" | "ino">): string {
  return createHash("sha256").update(`${String(stats.dev)}:${String(stats.ino)}`).digest("hex").slice(0, 24);
}

export function sameEntry(id: string, stats: Pick<Stats, "dev" | "ino">): boolean {
  return id.split("~", 1)[0] === entryId(stats);
}

/**
 * Resolves a library-relative path to a canonical absolute path without
 * following symbolic links: every component is checked with lstat, so a
 * symlink anywhere in the chain is rejected rather than escaped through.
 */
export async function resolveExisting(root: string, path: string): Promise<{ readonly abs: string; readonly stats: Stats }> {
  const segments = pathSegments(path);
  let current = root;
  let stats: Stats | null = null;
  for (const segment of segments) {
    current = `${current}${sep}${segment}`;
    stats = await lstat(current).catch((): null => null);
    if (stats === null) {
      throw new LibraryFileError(404, `“${path}” no longer exists. Refresh and try again.`);
    }
    if (stats.isSymbolicLink()) {
      throw new LibraryFileError(400, `“${path}” goes through a symbolic link, which Nanime doesn't manage.`);
    }
  }
  if (stats === null) {
    throw new LibraryFileError(400, "That path is outside the library.");
  }
  return { abs: current, stats };
}

/** Resolves an optional folder; `null` is the library root itself. */
export async function resolveFolder(root: string, path: string | null): Promise<string> {
  if (path === null) {
    return root;
  }
  const folder = await resolveExisting(root, path);
  if (!folder.stats.isDirectory()) {
    throw new LibraryFileError(400, `“${baseName(path)}” is not a folder.`);
  }
  return folder.abs;
}

export async function pathIsFree(abs: string): Promise<boolean> {
  return await lstat(abs).catch((): null => null) === null;
}
