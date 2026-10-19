import { LibraryFileError, hasInternalSegment } from "./libraryPaths.ts";
import { claimLibraryPaths } from "./libraryWriters.ts";
import { departedMediaPaths } from "./mediaPathHistory.ts";

/** Includes destinations reached through folder moves, not just the client's old spelling. */
export function playbackCandidatePaths(rel: string, restorePath?: string | null): readonly string[] {
  return [...new Set([rel, restorePath, ...departedMediaPaths(rel)])]
    .filter((path): path is string => typeof path === "string" && !hasInternalSegment(path));
}

/**
 * History lookup and admission are synchronous in the same turn. Keep the
 * lease across filesystem validation through the final progress/audit commit,
 * but not across the unrelated remote AniList sync. Ancestor operations overlap
 * these descendant claims through the shared library gate.
 */
export async function admittedPlaybackMutation<T>(paths: readonly string[], mutate: () => Promise<T>): Promise<T | Response> {
  let release: (() => void) | undefined = undefined;
  try {
    // A seeding torrent owns its files against moves, not against recording where a viewer stopped.
    release = claimLibraryPaths(paths, true);
    return await mutate();
  } catch (error) {
    if (error instanceof LibraryFileError) {
      return Response.json({ message: error.message }, { status: error.status });
    }
    throw error;
  } finally { release?.(); }
}
