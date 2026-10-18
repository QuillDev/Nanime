import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { ShowGroup } from "../lib/library.ts";
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

const PREFETCH_FRESH_MS = 10_000;

export function streamedSeasonPaths(entries: ShowGroup["entries"]): string[] {
  return entries.flatMap((entry) => (entry.direct ? [] : [entry.rel]));
}

function seasonQuery(paths: readonly string[]) {
  return {
    queryKey: [READINESS_KEY, ...paths],
    queryFn: ({ signal }: { readonly signal: AbortSignal }) => fetchPlaybackReadiness(paths, signal),
  };
}

/** Warm every season's readiness before the show page opens, so it renders the real state at once. */
export function usePrefetchShowReadiness(show: ShowGroup): () => void {
  const client = useQueryClient();
  return useCallback(() => {
    for (const season of show.seasons) {
      const paths = streamedSeasonPaths(season.entries);
      if (paths.length > 0) {
        void client.prefetchQuery({ ...seasonQuery(paths), staleTime: PREFETCH_FRESH_MS });
      }
    }
  }, [client, show]);
}

/** Readiness of streamed (non-direct) episodes: playable now, or needing a stored transcode. */
export function useSeasonReadiness(paths: readonly string[]) {
  return useQuery({
    ...seasonQuery(paths),
    enabled: paths.length > 0,
    refetchInterval: (query) => pollWhileTranscoding(query.state.data),
  });
}

export function usePlaybackReadiness(rel: string, enabled: boolean) {
  const paths = enabled ? [rel] : [];
  const query = useSeasonReadiness(paths);
  return { data: query.data?.items[0], error: query.error };
}
