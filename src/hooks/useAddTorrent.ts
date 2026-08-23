import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { addTorrent } from "../api.ts";
import { torrentsKey } from "./useTorrents.ts";

interface AddTorrentVariables {
  readonly file: File | null;
  readonly magnet: string;
  readonly showFolder: string;
}

export function useAddTorrent(): UseMutationResult<void, Error, AddTorrentVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, magnet, showFolder }) => addTorrent(file, magnet, showFolder),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["library"] }),
      queryClient.invalidateQueries({ queryKey: torrentsKey }),
    ]),
  });
}
