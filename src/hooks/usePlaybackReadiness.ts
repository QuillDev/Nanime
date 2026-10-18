import { useQuery } from "@tanstack/react-query";
import { fetchPlaybackReadiness, type PlaybackReadiness, type PlaybackReadinessBatch } from "../libraryApi.ts";

const READINESS_KEY = "playback-readiness";
const POLL_MS = 3000;

export function playbackReadinessKey() {
  return [READINESS_KEY] as const;
}

export function transcodeActive(item: PlaybackReadiness): boolean {
  const status = item.transcode?.status;
  return status === "queued" || status === "processing";
}

function pollWhileTranscoding(batch: PlaybackReadinessBatch | undefined): number | false {
  return batch?.items.some(transcodeActive) === true ? POLL_MS : false;
}

/** Readiness of streamed (non-direct) episodes: playable now, or needing a stored transcode. */
export function useSeasonReadiness(paths: readonly string[]) {
  return useQuery({
    queryKey: [READINESS_KEY, ...paths],
    queryFn: ({ signal }) => fetchPlaybackReadiness(paths, signal),
    enabled: paths.length > 0,
    refetchInterval: (query) => pollWhileTranscoding(query.state.data),
  });
}

export function usePlaybackReadiness(rel: string, enabled: boolean) {
  const paths = enabled ? [rel] : [];
  const query = useSeasonReadiness(paths);
  return { data: query.data?.items[0], error: query.error };
}
