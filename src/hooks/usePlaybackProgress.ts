import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { PlaybackProgress, PlaybackProgressMap } from "../types.ts";
import {
  dismissPlaybackProgress,
  fetchPlaybackProgress,
  savePlaybackProgress,
  type PlaybackProgressUpdate,
} from "../api.ts";

const playbackProgressKey = ["playback-progress"] as const;

interface DismissContext {
  readonly previous: PlaybackProgressMap | undefined;
}

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
      const optimistic: PlaybackProgress = {
        ...update,
        updatedAt: Date.now(),
        dismissedAt: null,
      };
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

export function useDismissPlaybackProgress(): UseMutationResult<
  PlaybackProgress,
  Error,
  string,
  DismissContext
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: dismissPlaybackProgress,
    onMutate: async (rel) => {
      await queryClient.cancelQueries({ queryKey: playbackProgressKey });
      const previous = queryClient.getQueryData<PlaybackProgressMap>(playbackProgressKey);
      queryClient.setQueryData<PlaybackProgressMap>(playbackProgressKey, (current) => {
        const item = current?.[rel];
        return item === undefined
          ? current
          : { ...current, [rel]: { ...item, dismissedAt: Date.now() } };
      });
      return { previous };
    },
    onError: (_error, _rel, context) => {
      queryClient.setQueryData(playbackProgressKey, context?.previous);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<PlaybackProgressMap>(playbackProgressKey, (current) => ({
        ...current,
        [saved.rel]: saved,
      }));
    },
  });
}
