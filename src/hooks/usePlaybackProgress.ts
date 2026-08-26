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
  setPlaybackWatched,
  type PlaybackProgressUpdate,
} from "../playbackApi.ts";

const playbackProgressKey = ["playback-progress"] as const;

interface DismissContext {
  readonly previous: PlaybackProgressMap | undefined;
}

interface WatchedUpdate {
  readonly rel: string;
  readonly watched: boolean;
  readonly anilistMediaId?: number;
  readonly episode?: number;
  readonly totalEpisodes?: number | null;
}

function aniListWatchedUpdate(update: WatchedUpdate) {
  if (update.anilistMediaId === undefined || update.episode === undefined ||
    update.totalEpisodes === undefined) {
    return undefined;
  }
  return {
    anilistMediaId: update.anilistMediaId,
    episode: update.episode,
    totalEpisodes: update.totalEpisodes,
  };
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

export function useSetPlaybackWatched(): UseMutationResult<
  PlaybackProgress,
  Error,
  WatchedUpdate,
  DismissContext
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update) => setPlaybackWatched(
      update.rel,
      update.watched,
      aniListWatchedUpdate(update),
    ),
    onMutate: async ({ rel, watched }) => {
      await queryClient.cancelQueries({ queryKey: playbackProgressKey });
      const previous = queryClient.getQueryData<PlaybackProgressMap>(playbackProgressKey);
      const existing = previous?.[rel];
      const optimistic: PlaybackProgress = {
        rel,
        position: watched ? existing?.position ?? 0 : 0,
        duration: existing?.duration ?? 0,
        completed: watched,
        updatedAt: Date.now(),
        dismissedAt: null,
      };
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
