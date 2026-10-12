import type { LibraryFileLock } from "../shared/libraryFiles.ts";
import { database } from "./database.ts";
import { hasInternalSegment, isInternalName, isSameOrInside, pathSegments } from "./libraryPaths.ts";

export const RECOVERY_LOCK: LibraryFileLock = {
  source: "recovery",
  reason: "An interrupted file operation here needs recovery. Restart Nanime or check the server log.",
  tone: "locked",
};
const unrecoveredOperations = database.query<{ readonly steps: string }, []>(
  "SELECT steps FROM library_file_operations WHERE status = 'recovery-required'",
);

function storedPath(value: unknown): string {
  if (typeof value !== "string") { throw new TypeError("Invalid stored recovery path"); }
  // Journal paths may include internal trash; validate their syntax without
  // opening those private paths to the public admission API.
  pathSegments(value.split("/").map((part) => isInternalName(part) ? `internal-${part.slice(".nanime-".length)}` : part).join("/"));
  if (value.length > 4096) { throw new Error("Invalid stored recovery path"); }
  return value;
}

function stepPaths(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object") { throw new Error("Invalid stored recovery step"); }
  const step = value as { readonly kind?: unknown; readonly from?: unknown; readonly to?: unknown };
  const to = storedPath(step.to);
  switch (step.kind) {
    case "mkdir": case "rmdir": {
      if (step.from !== null) { throw new Error("Invalid stored recovery source"); }
      return [to];
    }
    case "move-file": case "move-folder": { return [storedPath(step.from), to]; }
    default: { throw new Error("Unknown stored recovery step"); }
  }
}

/** Read SQLite synchronously at admission, never a stale startup snapshot. */
export function durableRecoveryPaths(): readonly string[] {
  try {
    return [...new Set(unrecoveredOperations.all().flatMap((row) => {
      const steps: unknown = JSON.parse(row.steps);
      if (!Array.isArray(steps) || steps.length === 0) { throw new Error("Invalid stored recovery steps"); }
      return steps.flatMap((step) => stepPaths(step).flatMap((path) => hasInternalSegment(path) ? [] : [path]));
    }))];
  } catch {
    // A corrupt scope cannot prove any location safe. Lock the whole library
    // instead of allowing writes or turning a predictable rejection into 500.
    return [""];
  }
}

export function recoveryAffecting(path: string): boolean {
  return durableRecoveryPaths().some((scope) => scope === "" || path === "" ||
    isSameOrInside(path, scope) || isSameOrInside(scope, path));
}
