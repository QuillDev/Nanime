import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchStorageStatus } from "../api.ts";
import type { StorageStatus } from "../types.ts";

export const storageStatusKey = ["storage-status"] as const;

export function useStorageStatus(): UseQueryResult<StorageStatus, Error> {
  return useQuery({
    queryKey: storageStatusKey,
    queryFn: ({ signal }) => fetchStorageStatus(signal),
    refetchInterval: 30_000,
  });
}
