import { api, unwrap } from "./api.ts";
import type { PlaybackAuditEvent, PlaybackProgress } from "./types.ts";

export async function fetchPlaybackHistory(
  signal: AbortSignal,
): Promise<readonly PlaybackAuditEvent[]> {
  return unwrap(
    await api.api.progress.history.get({
      query: { limit: "100" },
      fetch: { signal },
    }),
    "Playback history request",
  );
}

/** Returns progress at its resolved current path, or null when restoration clears it.
 * History event rel remains the immutable original path, not a cache key for this result. */
export async function restorePlaybackHistoryEvent(
  id: number,
): Promise<PlaybackProgress | null> {
  return unwrap(
    await api.api.progress.history({ id }).restore.post(),
    "Restoring playback history",
  );
}
