import type { MediaEntry } from "../types.ts";
import { usePlaybackReadiness } from "../hooks/usePlaybackReadiness.ts";
import { TranscodeRequired } from "./TranscodeRequired.tsx";

interface PlaybackGateProps {
  readonly entry: MediaEntry;
  readonly canTranscode: boolean;
  readonly seasonPaths: readonly string[];
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}

/**
 * Streamed episodes open the player only when the server can stream them
 * without a live software re-encode; otherwise offer a stored transcode.
 * A failed readiness check falls through to the player and its own errors.
 */
export function PlaybackGate({ entry, canTranscode, seasonPaths, onClose, children }: PlaybackGateProps): React.ReactNode {
  const streamed = !entry.direct && entry.offlineUrl === undefined;
  const readiness = usePlaybackReadiness(entry.rel, streamed);
  if (!streamed || readiness.error !== null) {
    return children;
  }
  if (readiness.data === undefined) {
    return null;
  }
  return readiness.data.ready
    ? children
    : (
        <TranscodeRequired
          entry={entry}
          readiness={readiness.data}
          seasonPaths={seasonPaths}
          canTranscode={canTranscode}
          onClose={onClose}
        />
      );
}
