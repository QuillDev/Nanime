import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { fetchLibraryFiles, sendLibraryFileRequest, type LibraryFileRequest } from "../libraryFilesApi.ts";

export const libraryFilesKey = ["library-files"] as const;

// File operations re-key watch progress, history, mappings, scans, and jobs by
// path, so every view derived from those paths is refreshed together.
const AFFECTED_QUERIES = [
  ["library"],
  ["library-status"],
  ["library-activity"],
  ["playback-progress"],
  ["playback-history"],
  ["show-metadata"],
  ["transcodes"],
  ["media-scans"],
] as const;

async function refreshAfterFileOperation(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: libraryFilesKey }),
    ...AFFECTED_QUERIES.map((queryKey) => client.invalidateQueries({ queryKey })),
  ]);
}

export function useLibraryFiles() {
  return useQuery({
    queryKey: libraryFilesKey,
    queryFn: ({ signal }) => fetchLibraryFiles(signal),
    // Download progress and job locks change on the server; keep them current.
    refetchInterval: 10_000,
  });
}

export function useLibraryFileOperation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: LibraryFileRequest) => sendLibraryFileRequest(request),
    // Settle after the refetch so the file manager receives the new listing in
    // the same turn it reports success, including after a rejected request.
    onSettled: () => refreshAfterFileOperation(client),
  });
}
