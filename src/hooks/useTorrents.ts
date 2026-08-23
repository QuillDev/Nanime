import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchTorrents } from "../api.ts";
import type { TorrentStatus } from "../types.ts";

export const torrentsKey = ["torrents"] as const;

export function useTorrents(enabled: boolean): UseQueryResult<readonly TorrentStatus[], Error> {
  return useQuery({
    queryKey: torrentsKey,
    queryFn: ({ signal }) => fetchTorrents(signal),
    enabled,
    refetchInterval: enabled ? 2000 : false,
  });
}
