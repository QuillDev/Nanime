import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { absolutePath, LibraryFileError } from "./libraryPaths.ts";

interface StepPaths {
  readonly from: string | null;
  readonly to: string;
}

function changed(path: string): LibraryFileError {
  return new LibraryFileError(409, `“${path}” changed while the operation was running. Nothing was overwritten.`);
}

/** Journal paths include internal trash names, but never traversal or empty segments. */
async function verifyParents(root: string, path: string): Promise<void> {
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.includes("\\") || segment.includes("\0"))) {
    throw changed(path);
  }
  let current: string | null = null;
  for (const segment of segments.slice(0, -1)) {
    current = current === null ? segment : `${current}/${segment}`;
    const stats = await lstat(absolutePath(root, current));
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw changed(current);
    }
  }
}

/** Check the root too: a relocated root/ancestor must not redirect recovery. */
export async function verifyStepPaths(root: string, step: StepPaths): Promise<void> {
  const stats = await lstat(root);
  if (!stats.isDirectory() || stats.isSymbolicLink() || await realpath(root) !== resolve(root)) {
    throw changed("Library root");
  }
  if (step.from !== null) {
    await verifyParents(root, step.from);
  }
  await verifyParents(root, step.to);
}
