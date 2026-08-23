import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { SubtitleTrack } from "../types.ts";
import { fetchSubtitleTracks } from "../api.ts";

export function useSubtitleTracks(rel: string): UseQueryResult<readonly SubtitleTrack[], Error> {
  return useQuery({
    queryKey: ["subtitle-tracks", rel],
    queryFn: ({ signal }) => fetchSubtitleTracks(rel, signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
