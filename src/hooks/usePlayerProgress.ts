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

interface PlayerProgressOptions {
  readonly anilistTarget: AniListPlaybackTarget | null;
  readonly entry: MediaEntry;
  readonly knownDuration: number;
  readonly resumeAt: number;
  readonly timelineOffset: number;
}

export function usePlayerProgress(options: PlayerProgressOptions): PlaybackHandlers {
  const { anilistTarget, entry, knownDuration, resumeAt, timelineOffset } = options;
  const lastSavedAtRef = useRef<number>(0);
  const { mutate: savePlayback } = useSavePlaybackProgress();
  const saveCurrentProgress = useCallback((video: HTMLVideoElement, completed: boolean) => {
    const position = video.currentTime + timelineOffset;
    const duration = Math.max(video.duration + timelineOffset, knownDuration);
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
  }, [anilistTarget, entry.rel, knownDuration, savePlayback, timelineOffset]);
  const handleLoadedMetadata = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const localResumeAt = resumeAt - timelineOffset;
    if (localResumeAt > 0 && localResumeAt < video.duration) {
      video.currentTime = localResumeAt;
    }
  }, [resumeAt, timelineOffset]);
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
