import { useQuery } from "@tanstack/react-query";
import { fetchConvertedProgress, type ConvertedProgress } from "../hlsApi.ts";

const REFRESH_MS = 2000;

/** Converted and converting parts of an episode, refreshed while the converted stream is on. */
export function useConvertedProgress(rel: string, audioTrack: number | null, enabled: boolean): ConvertedProgress | undefined {
  const { data } = useQuery({
    queryKey: ["converted-progress", rel, audioTrack],
    queryFn: ({ signal }) => fetchConvertedProgress(rel, audioTrack, signal),
    enabled,
    refetchInterval: enabled ? REFRESH_MS : false,
  });
  return enabled ? data : undefined;
}
