import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { addTorrent } from "../api.ts";
import { addDownloads } from "../downloadActions.ts";
import { downloadsKey } from "./useDownloads.ts";

interface AddTorrentVariables {
  readonly file: File | null;
  readonly magnet: string;
  readonly showFolder: string;
}

/** A .torrent file uploads to qBittorrent directly; a magnet goes through the shared download path. */
export function useAddTorrent(): UseMutationResult<void, Error, AddTorrentVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, magnet, showFolder }) => (file === null
      ? addDownloads(showFolder, [{ kind: "torrent", magnet }])
      : addTorrent(file, "", showFolder)),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["library"] }),
      queryClient.invalidateQueries({ queryKey: downloadsKey }),
    ]),
  });
}
