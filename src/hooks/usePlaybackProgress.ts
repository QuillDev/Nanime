import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { PlaybackProgress, PlaybackProgressMap } from "../types.ts";
import {
  fetchPlaybackProgress,
  savePlaybackProgress,
  type PlaybackProgressUpdate,
} from "../api.ts";

const playbackProgressKey = ["playback-progress"] as const;

function toProgressMap(progress: readonly PlaybackProgress[]): PlaybackProgressMap {
  return Object.fromEntries(progress.map((item) => [item.rel, item]));
}

export function usePlaybackProgress(): UseQueryResult<PlaybackProgressMap, Error> {
  return useQuery({
    queryKey: playbackProgressKey,
    queryFn: async ({ signal }) => toProgressMap(await fetchPlaybackProgress(signal)),
  });
}

export function useSavePlaybackProgress(): UseMutationResult<
  PlaybackProgress,
  Error,
  PlaybackProgressUpdate
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: savePlaybackProgress,
    onMutate: (update) => {
      const optimistic: PlaybackProgress = { ...update, updatedAt: Date.now() };
      queryClient.setQueryData<PlaybackProgressMap>(playbackProgressKey, (current) => ({
        ...current,
        [update.rel]: optimistic,
      }));
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<PlaybackProgressMap>(playbackProgressKey, (current) => {
        const existing = current?.[saved.rel];
        if (existing !== undefined && existing.updatedAt > saved.updatedAt) {
          return current;
        }
        return { ...current, [saved.rel]: saved };
      });
    },
  });
}
