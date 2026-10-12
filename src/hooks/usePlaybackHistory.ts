import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchPlaybackHistory,
  restorePlaybackHistoryEvent,
} from "../playbackHistoryApi.ts";
import { applyPlaybackHistoryRestore } from "../lib/playbackHistoryCache.ts";

const playbackHistoryKey = ["playback-history"] as const;

export function usePlaybackHistory() {
  return useQuery({
    queryKey: playbackHistoryKey,
    queryFn: ({ signal }) => fetchPlaybackHistory(signal),
  });
}

export function useRestorePlaybackHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: restorePlaybackHistoryEvent,
    onSuccess: (progress) => applyPlaybackHistoryRestore(queryClient, progress),
  });
}
