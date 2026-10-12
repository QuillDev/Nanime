import type { QueryClient } from "@tanstack/react-query";
import type { PlaybackProgress, PlaybackProgressMap } from "../types.ts";

/** Audit rel is immutable/original; returned progress.rel is the resolved current path.
 * A null response has no path, so only authoritative refetch can identify the removed row.
 */
export async function applyPlaybackHistoryRestore(
  queryClient: QueryClient,
  progress: PlaybackProgress | null,
): Promise<void> {
  if (progress !== null) {
    queryClient.setQueryData<PlaybackProgressMap>(["playback-progress"], (current) => ({
      ...current,
      [progress.rel]: progress,
    }));
  }
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["playback-progress"] }),
    queryClient.invalidateQueries({ queryKey: ["playback-history"] }),
  ]);
}
