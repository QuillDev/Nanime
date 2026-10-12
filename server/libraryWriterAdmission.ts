import { realpath } from "node:fs/promises";
import type { Stats } from "node:fs";
import { localLocks, lockAffecting } from "./libraryLocks.ts";
import { LibraryFileError, parentPath, pathSegments, resolveExisting } from "./libraryPaths.ts";
import { claimLibraryPaths } from "./libraryWriters.ts";

export { resolveExisting, LibraryFileError } from "./libraryPaths.ts";
export { claimTranscodeWorkerPaths } from "./libraryWriters.ts";

interface WriterAdmission {
  readonly root: string;
  readonly paths: readonly string[];
  /** Rewrites also touch sidecars and temporary siblings. */
  readonly siblings?: boolean;
  /** Reader job admissions may reuse their own persisted jobs. */
  readonly allowJobs?: boolean;
}

export interface WriterSource {
  readonly abs: string;
  readonly stats: Stats;
}

/** Reserve before any awaited filesystem validation; aliases are rejected. */
export async function libraryWriterResponse(
  admission: WriterAdmission,
  work: (sources: readonly WriterSource[]) => Promise<Response>,
): Promise<Response> {
  let release: (() => void) | undefined = undefined;
  try {
    for (const path of admission.paths) {
      pathSegments(path);
    }
    const scopes = admission.siblings === true
      ? admission.paths.map((path) => parentPath(path) ?? "") : admission.paths;
    const locks = localLocks({ uploads: () => [] }).filter((entry) => (
      admission.allowJobs !== true || entry.lock.source === "recovery"
    ));
    for (const path of scopes) {
      const locked = path === "" ? locks[0] : lockAffecting({ paths: locks, global: null, ownership: "unconfigured" }, path);
      if (locked !== undefined && locked !== null) {
        throw new LibraryFileError(423, locked.lock.reason);
      }
    }
    release = claimLibraryPaths(scopes, true);
    const root = await realpath(admission.root);
    const sources = await Promise.all(admission.paths.map((path) => resolveExisting(root, path)));
    return await work(sources);
  } catch (error) {
    if (error instanceof LibraryFileError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  } finally {
    release?.();
  }
}

/** Reject a replaced source even when size and timestamps have been copied. */
export async function revalidateWriterSource(root: string, path: string, expected: Stats): Promise<void> {
  const canonicalRoot = await realpath(root);
  const current = await resolveExisting(canonicalRoot, path);
  if (current.stats.dev !== expected.dev || current.stats.ino !== expected.ino ||
    current.stats.size !== expected.size || current.stats.mtimeMs !== expected.mtimeMs) {
    throw new LibraryFileError(409, "Source media changed during setup. Try again.");
  }
}
