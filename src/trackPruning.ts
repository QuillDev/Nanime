import { api, unwrap } from "./api.ts";
import type { TrackPruneOperation } from "./types.ts";

export type PruneMode = "audio" | "subtitles";

export interface ManagedTrack {
  readonly index: number;
  readonly label: string;
  readonly sizeBytes: number | null;
}

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
