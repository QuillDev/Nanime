import { api, unwrap } from "./api.ts";
import type { TrackPruneOperation } from "./types.ts";

export async function pruneTracks(operations: readonly TrackPruneOperation[]): Promise<number> {
  return unwrap(
    await api.api.media["prune-tracks"].post({
      operations: operations.map((operation) => ({
        ...operation,
        audioIndices: [...operation.audioIndices],
        subtitleIndices: [...operation.subtitleIndices],
      })),
    }),
    "Pruning tracks",
  ).processed;
}
