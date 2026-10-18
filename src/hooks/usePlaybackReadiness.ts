import { useQuery } from "@tanstack/react-query";
import { fetchPlaybackReadiness, type PlaybackReadiness } from "../libraryApi.ts";

export function playbackReadinessKey(rel: string) {
  return ["playback-readiness", rel] as const;
}

function pollWhileTranscoding(readiness: PlaybackReadiness | undefined): number | false {
  const status = readiness?.transcode?.status;
  return readiness?.ready === false && (status === "queued" || status === "processing") ? 3000 : false;
}

/** Whether a streamed (non-direct) episode can play now or needs a stored transcode first. */
export function usePlaybackReadiness(rel: string, enabled: boolean) {
  return useQuery({
    queryKey: playbackReadinessKey(rel),
    queryFn: ({ signal }) => fetchPlaybackReadiness(rel, signal),
    enabled,
    refetchInterval: (query) => pollWhileTranscoding(query.state.data),
  });
}
