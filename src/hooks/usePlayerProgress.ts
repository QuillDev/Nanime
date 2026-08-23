import { useCallback, useRef, type SyntheticEvent } from "react";
import type { AniListPlaybackTarget, MediaEntry } from "../types.ts";
import { useSavePlaybackProgress } from "./usePlaybackProgress.ts";
import { hasMeaningfulPlaybackProgress } from "../lib/playback.ts";

export interface PlaybackHandlers {
  readonly saveCurrentProgress: (video: HTMLVideoElement, completed: boolean) => void;
  readonly handleLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handleTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handlePause: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handleSeeked: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handleEnded: (event: SyntheticEvent<HTMLVideoElement>) => void;
}

export function usePlayerProgress(
  entry: MediaEntry,
  resumeAt: number,
  anilistTarget: AniListPlaybackTarget | null,
): PlaybackHandlers {
  const lastSavedAtRef = useRef<number>(0);
  const { mutate: savePlayback } = useSavePlaybackProgress();
  const saveCurrentProgress = useCallback((video: HTMLVideoElement, completed: boolean) => {
    const { currentTime: position, duration } = video;
    if (
      !Number.isFinite(position) ||
      !hasMeaningfulPlaybackProgress(position) ||
      !Number.isFinite(duration)
    ) {
      return;
    }
    lastSavedAtRef.current = Date.now();
    const progress = {
      rel: entry.rel,
      position,
      duration,
      completed,
    };
    savePlayback(anilistTarget === null
      ? progress
      : {
        ...progress,
        anilistMediaId: anilistTarget.mediaId,
        episode: anilistTarget.episode,
        totalEpisodes: anilistTarget.totalEpisodes,
      });
  }, [anilistTarget, entry.rel, savePlayback]);
  const handleLoadedMetadata = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (resumeAt > 0 && resumeAt < video.duration) {
      video.currentTime = resumeAt;
    }
  }, [resumeAt]);
  const handleTimeUpdate = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    if (Date.now() - lastSavedAtRef.current >= 10_000) {
      saveCurrentProgress(event.currentTarget, false);
    }
  }, [saveCurrentProgress]);
  const handlePause = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    if (!event.currentTarget.ended) {
      saveCurrentProgress(event.currentTarget, false);
    }
  }, [saveCurrentProgress]);
  const handleSeeked = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    saveCurrentProgress(event.currentTarget, false);
  }, [saveCurrentProgress]);
  const handleEnded = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    saveCurrentProgress(event.currentTarget, true);
  }, [saveCurrentProgress]);
  return {
    saveCurrentProgress,
    handleLoadedMetadata,
    handleTimeUpdate,
    handlePause,
    handleSeeked,
    handleEnded,
  };
}
