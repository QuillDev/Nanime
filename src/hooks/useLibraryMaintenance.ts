import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchLibraryStatus,
  fetchMetadataRefreshStatus,
  refreshLibrary,
  refreshMetadata,
} from "../libraryMaintenance.ts";

const libraryStatusKey = ["library-status"] as const;
const metadataRefreshKey = ["metadata-refresh"] as const;

export function useLibraryStatus() {
  return useQuery({
    queryKey: libraryStatusKey,
    queryFn: ({ signal }) => fetchLibraryStatus(signal),
    refetchInterval: (query) => query.state.data?.scanning === true ? 2000 : 30_000,
  });
}

export function useRefreshLibrary() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: refreshLibrary,
    onSuccess: (status) => {
      client.setQueryData(libraryStatusKey, status);
      return client.invalidateQueries({ queryKey: ["library"] });
    },
  });
}

export function useMetadataRefreshStatus() {
  return useQuery({
    queryKey: metadataRefreshKey,
    queryFn: ({ signal }) => fetchMetadataRefreshStatus(signal),
    refetchInterval: (query) => query.state.data?.state === "running" ? 2000 : 30_000,
  });
}

export function useRefreshMetadata() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: refreshMetadata,
    onSuccess: (status) => {
      client.setQueryData(metadataRefreshKey, status);
    },
  });
}
