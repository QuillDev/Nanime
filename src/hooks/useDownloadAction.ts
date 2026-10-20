import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { controlDownload, type DownloadAction } from "../downloadActions.ts";
import { storageStatusKey } from "./useStorageStatus.ts";
import { downloadsKey } from "./useDownloads.ts";
import { refreshLibraryCache } from "./refreshLibraryCache.ts";

interface DownloadActionVariables {
  readonly id: string;
  readonly action: DownloadAction;
  readonly deleteFiles?: boolean;
}

export function useDownloadAction(): UseMutationResult<void, Error, DownloadActionVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, deleteFiles }) => controlDownload(id, action, deleteFiles),
    onSuccess: (_data, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: downloadsKey }),
      variables.deleteFiles === true ? refreshLibraryCache(queryClient) : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: storageStatusKey }),
    ]),
  });
}
