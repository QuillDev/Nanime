import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchTrickplayManifest } from "../api.ts";
import type { TrickplayManifest } from "../types.ts";

function refreshInterval(status: TrickplayManifest["status"] | undefined): number | false {
  if (status === "generating") {
    return 2000;
  }
  if (status === "unavailable") {
    return 300_000;
  }
  return false;
}

export function useTrickplay(rel: string): UseQueryResult<TrickplayManifest, Error> {
  return useQuery({
    queryKey: ["trickplay", rel],
    queryFn: ({ signal }) => fetchTrickplayManifest(rel, signal),
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: (query) => refreshInterval(query.state.data?.status),
  });
}
