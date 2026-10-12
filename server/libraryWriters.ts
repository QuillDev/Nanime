import { hasInternalSegment, isSameOrInside, LibraryFileError, pathSegments } from "./libraryPaths.ts";
import { RECOVERY_LOCK, recoveryAffecting } from "./libraryRecoveryScopes.ts";

/** Shared synchronous admission gate. Single server process per library. */
interface Claim { readonly paths: readonly string[]; readonly torrentOwnership: boolean }
const changing = new Set<Claim>();
const transcodeWorkers = new Set<readonly string[]>();

export function activeTranscodeWorkerPaths(): readonly string[] {
  return [...transcodeWorkers].flat();
}

/** Worker ownership lasts beyond persisted cancellation until cleanup settles. */
export function claimTranscodeWorkerPaths(paths: readonly string[]): () => void {
  const release = claimLibraryPaths(paths, true);
  const held = [...paths];
  transcodeWorkers.add(held);
  return () => { transcodeWorkers.delete(held); release(); };
}

export function activeLibraryWriterPaths(): readonly string[] {
  return [...changing].flatMap((claim) => claim.paths);
}

export function libraryPathBusy(path: string, ignoreTorrentOwnership = false): boolean {
  for (const claim of changing) {
    if (ignoreTorrentOwnership && claim.torrentOwnership) {
      continue;
    }
    if (claim.paths.some((changed) => changed === "" || path === "" ||
      isSameOrInside(path, changed) || isSameOrInside(changed, path))) {
      return true;
    }
  }
  return false;
}

/** Check and reserve in the same synchronous turn; never overwrite a claim. */
export function claimLibraryPaths(paths: readonly string[], ignoreTorrentOwnership = false): () => void {
  for (const path of paths) {
    if (path !== "") {
      pathSegments(path);
    }
    if (recoveryAffecting(path)) {
      throw new LibraryFileError(423, RECOVERY_LOCK.reason);
    }
    if (libraryPathBusy(path, ignoreTorrentOwnership)) {
      throw new LibraryFileError(423, "A library writer is using this location. Try again in a moment.");
    }
  }
  const claim: Claim = { paths: [...paths], torrentOwnership: false };
  changing.add(claim);
  return () => { changing.delete(claim); };
}

/** Ownership handoff remains visible even to a manager holding an older qB snapshot. */
export function retainTorrentOwnership(paths: readonly string[]): () => void {
  const claim: Claim = { paths: [...paths], torrentOwnership: true };
  changing.add(claim);
  return () => { changing.delete(claim); };
}

export function libraryPathUnavailable(path: string): string | null {
  if (hasInternalSegment(path)) {
    return "Nanime's internal folders can't be used here.";
  }
  if (recoveryAffecting(path)) { return RECOVERY_LOCK.reason; }
  return libraryPathBusy(path) ? "A library file operation is changing this location. Try again in a moment." : null;
}
