import {
  queryOptions,
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
  setPlaybackWatched,
  setPlaybackWatchedBatch,
  type PlaybackProgressUpdate,
  type PlaybackWatchedUpdate,
} from "../playbackApi.ts";

const playbackProgressKey = ["playback-progress"] as const;

interface DismissContext {
  readonly previous: PlaybackProgressMap | undefined;
}

function optimisticWatchedProgress(
  update: PlaybackWatchedUpdate,
  existing: PlaybackProgress | undefined,
): PlaybackProgress {
  return {
    rel: update.rel,
    position: update.watched ? existing?.position ?? 0 : 0,
    duration: existing?.duration ?? 0,
    completed: update.watched,
    updatedAt: Date.now(),
    dismissedAt: null,
  };
}

function toProgressMap(progress: readonly PlaybackProgress[]): PlaybackProgressMap {
  return Object.fromEntries(progress.map((item) => [item.rel, item]));
}

export const playbackProgressQuery = queryOptions({
  queryKey: playbackProgressKey,
  queryFn: async ({ signal }) => toProgressMap(await fetchPlaybackProgress(signal)),
});

export function usePlaybackProgress(): UseQueryResult<PlaybackProgressMap, Error> {
  return useQuery(playbackProgressQuery);
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

export function useSetPlaybackWatched(): UseMutationResult<
  PlaybackProgress,
  Error,
  PlaybackWatchedUpdate,
  DismissContext
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update) => setPlaybackWatched(
      update.rel,
      update.watched,
      update,
    ),
    onMutate: async ({ rel, watched }) => {
      await queryClient.cancelQueries({ queryKey: playbackProgressKey });
      const previous = queryClient.getQueryData<PlaybackProgressMap>(playbackProgressKey);
      const existing = previous?.[rel];
      const optimistic = optimisticWatchedProgress({ rel, watched }, existing);
      queryClient.setQueryData<PlaybackProgressMap>(playbackProgressKey, (current) => ({
        ...current,
        [rel]: optimistic,
      }));
      return { previous };
    },
    onError: (_error, _update, context) => {
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

export function useSetSeasonWatched(): UseMutationResult<
  readonly PlaybackProgress[],
  Error,
  readonly PlaybackWatchedUpdate[],
  DismissContext
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setPlaybackWatchedBatch,
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: playbackProgressKey });
      const previous = queryClient.getQueryData<PlaybackProgressMap>(playbackProgressKey);
      queryClient.setQueryData<PlaybackProgressMap>(playbackProgressKey, (current) => {
        const next = { ...current };
        for (const update of updates) {
          next[update.rel] = optimisticWatchedProgress(update, current?.[update.rel]);
        }
        return next;
      });
      return { previous };
    },
    onError: (_error, _updates, context) => {
      queryClient.setQueryData(playbackProgressKey, context?.previous);
      return queryClient.invalidateQueries({ queryKey: playbackProgressKey });
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<PlaybackProgressMap>(playbackProgressKey, (current) => ({
        ...current,
        ...toProgressMap(saved),
      }));
    },
  });
}
