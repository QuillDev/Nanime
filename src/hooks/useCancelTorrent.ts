import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { cancelTorrent } from "../torrentActions.ts";
import { storageStatusKey } from "./useStorageStatus.ts";
import { torrentsKey } from "./useTorrents.ts";
import { refreshLibraryCache } from "./refreshLibraryCache.ts";

interface CancelTorrentVariables {
  readonly hash: string;
  readonly deleteFiles: boolean;
}

export function useCancelTorrent(): UseMutationResult<void, Error, CancelTorrentVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ hash, deleteFiles }) => cancelTorrent(hash, deleteFiles),
    onSuccess: (_data, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: torrentsKey }),
      variables.deleteFiles
        ? refreshLibraryCache(queryClient)
        : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: storageStatusKey }),
    ]),
  });
}
