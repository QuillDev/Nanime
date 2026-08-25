import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { MediaEntry } from "../types.ts";
import { fetchLibrary, fetchMediaDuration } from "../api.ts";

export function useLibrary(): UseQueryResult<readonly MediaEntry[], Error> {
  return useQuery({
    queryKey: ["library"],
    queryFn: ({ signal }) => fetchLibrary(signal),
    refetchInterval: 60_000,
  });
}

export function useMediaDuration(rel: string | null): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: ["media-duration", rel],
    queryFn: ({ signal }) => rel === null
      ? Promise.reject(new Error("A media path is required."))
      : fetchMediaDuration(rel, signal),
    enabled: rel !== null,
    staleTime: Infinity,
  });
}
