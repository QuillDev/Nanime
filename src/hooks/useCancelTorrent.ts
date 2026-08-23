import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { cancelTorrent } from "../torrentActions.ts";
import { storageStatusKey } from "./useStorageStatus.ts";
import { torrentsKey } from "./useTorrents.ts";

interface CancelTorrentVariables {
  readonly hash: string;
  readonly deleteFiles: boolean;
}

export function useCancelTorrent(): UseMutationResult<void, Error, CancelTorrentVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ hash, deleteFiles }) => cancelTorrent(hash, deleteFiles),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: torrentsKey }),
      queryClient.invalidateQueries({ queryKey: ["library"] }),
      queryClient.invalidateQueries({ queryKey: storageStatusKey }),
    ]),
  });
}
