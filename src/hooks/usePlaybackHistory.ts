import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlaybackAuditEvent, PlaybackProgress } from "../types.ts";
import {
  fetchPlaybackHistory,
  restorePlaybackHistoryEvent,
} from "../playbackHistoryApi.ts";

const playbackHistoryKey = ["playback-history"] as const;
const playbackProgressKey = ["playback-progress"] as const;

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
    onSuccess: (progress: PlaybackProgress | null, eventId: number) => {
      const history = queryClient.getQueryData<readonly PlaybackAuditEvent[]>(playbackHistoryKey);
      const event = history?.find((item) => item.id === eventId);
      if (event !== undefined) {
        queryClient.setQueryData<Record<string, PlaybackProgress>>(playbackProgressKey, (current) => {
          const next = { ...current };
          if (progress === null) {
            delete next[event.rel];
          } else {
            next[event.rel] = progress;
          }
          return next;
        });
      }
      return queryClient.invalidateQueries({ queryKey: playbackHistoryKey });
    },
  });
}
