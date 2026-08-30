import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchAudioTracks } from "../audio.ts";
import type { AudioTrack } from "../types.ts";

export function useAudioTracks(
  rel: string,
  enabled = true,
): UseQueryResult<readonly AudioTrack[], Error> {
  return useQuery({
    queryKey: ["audio-tracks", rel],
    queryFn: ({ signal }) => fetchAudioTracks(rel, signal),
    staleTime: Number.POSITIVE_INFINITY,
    enabled,
  });
}
