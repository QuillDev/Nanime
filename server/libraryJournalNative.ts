import { dlopen, ptr, read } from "bun:ffi";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync, type Stats } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getSystemErrorName } from "node:util";
import { LibraryFileError } from "./libraryPaths.ts";

// ABI: Linux fcntl.h, stdio.h, sys/stat.h and linux/fs.h. All paths passed
// to *at are single components; no kernel pathname walk follows a symlink.
export const JOURNAL_NATIVE_SYMBOLS = {
  openat: { args: ["i32", "ptr", "i32", "u32"], returns: "i32" },
  mkdirat: { args: ["i32", "ptr", "u32"], returns: "i32" },
  unlinkat: { args: ["i32", "ptr", "i32"], returns: "i32" },
  renameat2: { args: ["i32", "ptr", "i32", "ptr", "u32"], returns: "i32" },
  __errno_location: { args: [], returns: "ptr" },
} as const;
function loadNative() {
  if (process.platform !== "linux") { throw new LibraryFileError(409, "Native journal mutations are unavailable. Nothing was changed."); }
  try {
    return dlopen("libc.so.6", JOURNAL_NATIVE_SYMBOLS);
  } catch { throw new LibraryFileError(409, "Native journal mutations are unavailable. No unsafe rename fallback was attempted."); }
}
let native: ReturnType<typeof loadNative> | null = null;
function api() { native ??= loadNative(); return native.symbols; }
function nameBuffer(name: string): Buffer {
  if (!name || name === "." || name === ".." || /[/\\\0]/u.test(name)) { throw new LibraryFileError(409, "Invalid journal component."); }
  return Buffer.from(`${name}\0`);
}
function result(value: number): number {
  if (value >= 0) { return value; }
  const pointer = api()["__errno_location"]();
  if (pointer === null) { throw new LibraryFileError(409, "Native journal failure without errno. Recovery is required."); }
  const code = getSystemErrorName(-read.i32(pointer));
  throw Object.assign(new LibraryFileError(409, `Native journal mutation failed (${code}). Nothing was overwritten. No unsafe rename fallback was attempted.`), { code });
}
export interface Anchor { readonly fd: number; readonly path: string }
// Linux bits/fcntl-linux.h: O_CLOEXEC = 02000000 (not exposed by node:fs).
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | 0o200_0000;
export function closeAnchor(anchor: Anchor): void { closeSync(anchor.fd); }
export function anchorChild(parent: Anchor, name: string): Anchor {
  const buffer = nameBuffer(name);
  const fd = result(api().openat(parent.fd, ptr(buffer), DIRECTORY_FLAGS, 0));
  return { fd, path: `${parent.path === "/" ? "" : parent.path}/${name}` };
}
/** Walk root ancestors from / with O_NOFOLLOW on EVERY component. */
export function anchorRoot(root: string): Anchor {
  api();
  let anchor: Anchor = { fd: openSync("/", DIRECTORY_FLAGS), path: "/" };
  try {
    for (const name of resolve(root).split("/").filter(Boolean)) {
      const child = anchorChild(anchor, name);
      closeAnchor(anchor);
      anchor = child;
    }
    return anchor;
  } catch (error) { closeAnchor(anchor); throw error; }
}
export function anchorParent(root: Anchor, path: string): Anchor {
  const names = path.split("/");
  for (const name of names) { nameBuffer(name); }
  const dot = Buffer.from(".\0");
  let anchor: Anchor = { fd: result(api().openat(root.fd, ptr(dot), DIRECTORY_FLAGS, 0)), path: root.path };
  try {
    for (const name of names.slice(0, -1)) {
      const child = anchorChild(anchor, name);
      closeAnchor(anchor);
      anchor = child;
    }
    assertAnchor(anchor);
    return anchor;
  } catch (error) { closeAnchor(anchor); throw error; }
}
/** Descriptor provenance checked immediately at each synchronous syscall boundary.
 * FDs prevent a replaced pathname/symlink from redirecting the syscall. Linux
 * has no rename-by-inode or renameat2 RESOLVE_BENEATH: a same-UID adversary able
 * to relocate pinned directories concurrently can still move their topology.
 * Root/ancestors and the app-private staging namespace must be trusted. Public
 * entry names are NOT trusted, including the name immediately before rename.
 */
export function assertAnchor(anchor: Anchor): void {
  if (realpathSync(`/proc/self/fd/${anchor.fd}`) !== anchor.path) {
    throw new LibraryFileError(409, "A parent changed while the operation was running. Nothing was overwritten.");
  }
}
export function statsAt(parent: Anchor, name: string): Stats | null {
  nameBuffer(name);
  assertAnchor(parent);
  try { return lstatSync(`/proc/self/fd/${parent.fd}/${name}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") { throw error; } return null; }
}
export interface AnchoredEntry { readonly parent: Anchor; readonly name: string }
export function renameAtNoReplace(from: AnchoredEntry, to: AnchoredEntry): void {
  const source = nameBuffer(from.name); const target = nameBuffer(to.name);
  assertAnchor(from.parent); assertAnchor(to.parent);
  result(api().renameat2(from.parent.fd, ptr(source), to.parent.fd, ptr(target), 1));
}
export function mkdirAt(parent: Anchor, name: string, mode = 0o755): void {
  const buffer = nameBuffer(name); assertAnchor(parent);
  result(api().mkdirat(parent.fd, ptr(buffer), mode));
}
/** ONLY trusted private staging names may be destroyed, never public names. */
export function removeStaged(parent: Anchor, name: string, directory: boolean): void {
  const buffer = nameBuffer(name); assertAnchor(parent);
  result(api().unlinkat(parent.fd, ptr(buffer), directory ? 0x02_00 : 0));
}
function privateChild(parent: Anchor, name: string): Anchor {
  try { mkdirAt(parent, name, 0o700); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") { throw error; } }
  const stage = anchorChild(parent, name);
  const stats = fstatSync(stage.fd);
  if (stats.uid !== process.getuid?.() || (stats.mode & 0o777) !== 0o700) {
    closeAnchor(stage);
    throw new LibraryFileError(409, "Journal staging must be private (owner-only 0700). Recovery is required.");
  }
  return stage;
}
export function journalStageLocation(root: string): string {
  const absolute = resolve(root);
  const key = createHash("sha256").update(absolute).digest("hex");
  return join(dirname(absolute), ".nanime-journal", key);
}
/** Sibling storage is outside the downloader's media-root bind mount. Owner-only
 * permissions inside that mount are insufficient when both processes share UID.
 * The private sibling and media must share a filesystem; never copy as fallback. */
export function privateStage(root: Anchor): Anchor {
  const parent = anchorRoot(dirname(root.path));
  let base: Anchor | null = null;
  let stage: Anchor | null = null;
  try {
    base = privateChild(parent, ".nanime-journal");
    const key = createHash("sha256").update(root.path).digest("hex");
    stage = privateChild(base, key);
    if (fstatSync(stage.fd).dev !== fstatSync(root.fd).dev) {
      throw new LibraryFileError(409, "Private journal storage and media must share a filesystem. No unsafe copy fallback was attempted.");
    }
    return stage;
  } catch (error) {
    if (stage !== null) { closeAnchor(stage); }
    throw error;
  } finally {
    if (base !== null) { closeAnchor(base); }
    closeAnchor(parent);
  }
}
