import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchDownloads, type DownloadList } from "../downloadActions.ts";

export const downloadsKey = ["downloads"] as const;

export function useDownloads(enabled: boolean): UseQueryResult<DownloadList, Error> {
  return useQuery({
    queryKey: downloadsKey,
    queryFn: ({ signal }) => fetchDownloads(signal),
    enabled,
    refetchInterval: enabled ? 2000 : false,
  });
}
