import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { deleteMedia } from "../api.ts";

export function useDeleteMedia(): UseMutationResult<number, Error, readonly string[]> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMedia,
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["library"] }),
      queryClient.invalidateQueries({ queryKey: ["playback-progress"] }),
      queryClient.invalidateQueries({ queryKey: ["torrents"] }),
    ]),
  });
}
