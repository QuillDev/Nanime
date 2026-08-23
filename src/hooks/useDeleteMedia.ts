import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { deleteMedia } from "../api.ts";
import { refreshLibraryCache } from "./refreshLibraryCache.ts";

export function useDeleteMedia(): UseMutationResult<number, Error, readonly string[]> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMedia,
    onSuccess: () => Promise.all([
      refreshLibraryCache(queryClient),
      queryClient.invalidateQueries({ queryKey: ["playback-progress"] }),
      queryClient.invalidateQueries({ queryKey: ["torrents"] }),
    ]),
  });
}
