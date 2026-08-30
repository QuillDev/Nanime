import { useCallback, useRef, type SyntheticEvent } from "react";
import type { AniListPlaybackTarget, MediaEntry, PlaybackProgress } from "../types.ts";
import { useSavePlaybackProgress } from "./usePlaybackProgress.ts";
import { hasMeaningfulPlaybackProgress } from "../lib/playback.ts";
import { resolvedPlaybackDuration } from "../../shared/playback.ts";
import { useSeriesCompletionPrompt } from "../components/SeriesCompletionPrompt.tsx";
import type { PlaybackProgressUpdate } from "../playbackApi.ts";

export interface PlaybackHandlers {
  readonly saveCurrentProgress: (
    video: HTMLVideoElement,
    completed: boolean,
    event?: PlaybackProgressUpdate["event"],
  ) => void;
  readonly handlePlay: (event: SyntheticEvent<HTMLVideoElement>) => void;
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
  readonly playbackPosition: (video: HTMLVideoElement) => number;
}

function useInitialPosition(resumeAt: number, timelineOffset: number) {
  const initializedRef = useRef(false);
  return useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    const video = event.currentTarget;
    const localResumeAt = resumeAt - timelineOffset;
    if (localResumeAt > 0 && localResumeAt < video.duration) {
      video.currentTime = localResumeAt;
    }
  }, [resumeAt, timelineOffset]);
}

function useProgressSaver(target: AniListPlaybackTarget | null) {
  const promptedRef = useRef(false);
  const promptForScore = useSeriesCompletionPrompt();
  const { mutate } = useSavePlaybackProgress();
  const notifyCompletion = useCallback((saved: PlaybackProgress) => {
    if (saved.completed && target !== null && !promptedRef.current) {
      promptedRef.current = true;
      promptForScore(target);
    }
  }, [promptForScore, target]);
  return useCallback((update: PlaybackProgressUpdate) => {
    mutate(update, { onSuccess: notifyCompletion });
  }, [mutate, notifyCompletion]);
}

function usePlaybackSaving(target: AniListPlaybackTarget | null) {
  return {
    lastSavedAtRef: useRef<number>(0),
    savePlayback: useProgressSaver(target),
  };
}

export function usePlayerProgress(options: PlayerProgressOptions): PlaybackHandlers {
  const { anilistTarget, entry, knownDuration, playbackPosition, resumeAt, timelineOffset } = options;
  const { lastSavedAtRef, savePlayback } = usePlaybackSaving(anilistTarget);
  const saveCurrentProgress = useCallback((
    video: HTMLVideoElement,
    completed: boolean,
    event: PlaybackProgressUpdate["event"] = "heartbeat",
  ) => {
    const position = playbackPosition(video);
    const duration = resolvedPlaybackDuration({
      mediaDuration: video.duration,
      localPosition: video.currentTime,
      absolutePosition: position,
      knownDuration,
    });
    if (
      !Number.isFinite(position) ||
      event !== "started" && !hasMeaningfulPlaybackProgress(position) ||
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
      event: completed ? "completed" : event,
    };
    savePlayback(anilistTarget === null
      ? progress
      : {
        ...progress,
        anilistMediaId: anilistTarget.mediaId,
        episode: anilistTarget.episode,
        totalEpisodes: anilistTarget.totalEpisodes,
      });
  }, [anilistTarget, entry.rel, knownDuration, lastSavedAtRef, playbackPosition, savePlayback]);
  const handleLoadedMetadata = useInitialPosition(resumeAt, timelineOffset);
  const handlePlay = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    saveCurrentProgress(event.currentTarget, false, "started");
  }, [saveCurrentProgress]);
  const handleTimeUpdate = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    if (Date.now() - lastSavedAtRef.current >= 10_000) {
      saveCurrentProgress(event.currentTarget, false, "heartbeat");
    }
  }, [lastSavedAtRef, saveCurrentProgress]);
  const handlePause = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    if (!event.currentTarget.ended) {
      saveCurrentProgress(event.currentTarget, false, "stopped");
    }
  }, [saveCurrentProgress]);
  const handleSeeked = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    saveCurrentProgress(event.currentTarget, false, "seeked");
  }, [saveCurrentProgress]);
  const handleEnded = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    saveCurrentProgress(event.currentTarget, true, "completed");
  }, [saveCurrentProgress]);
  return {
    saveCurrentProgress,
    handlePlay,
    handleLoadedMetadata,
    handleTimeUpdate,
    handlePause,
    handleSeeked,
    handleEnded,
  };
}
