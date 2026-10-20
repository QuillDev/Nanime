import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { pruneTracks } from "../trackPruning.ts";
import type { TrackPruneOperation } from "../types.ts";

export type { ManagedTrack, PruneMode } from "../trackPruning.ts";

export function usePruneTracks(): UseMutationResult<number, Error, readonly TrackPruneOperation[]> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: pruneTracks,
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: ["audio-tracks"] }),
      client.invalidateQueries({ queryKey: ["subtitle-tracks"] }),
      client.invalidateQueries({ queryKey: ["library"] }),
      client.invalidateQueries({ queryKey: ["downloads"] }),
    ]),
  });
}
