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

export function playerResumePosition(progress: PlaybackProgress | undefined): number {
  return progress?.completed === false && hasMeaningfulPlaybackProgress(progress.position)
    ? progress.position : 0;
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
    startedAtRef: useRef<number | null>(null),
    savePlayback: useProgressSaver(target),
  };
}

function progressUpdate(options: {
  readonly mediaIdentity: string | undefined;
  readonly rel: string;
  readonly position: number;
  readonly duration: number;
  readonly completed: boolean;
  readonly event: NonNullable<PlaybackProgressUpdate["event"]>;
  readonly sessionSeconds: number | undefined;
}): PlaybackProgressUpdate {
  const update: PlaybackProgressUpdate = {
    rel: options.rel,
    position: options.position,
    duration: options.duration,
    completed: options.completed,
    event: options.completed ? "completed" : options.event,
  };
  const identified = options.mediaIdentity === undefined ? update : { ...update, mediaIdentity: options.mediaIdentity };
  return options.sessionSeconds === undefined
    ? identified
    : { ...identified, sessionSeconds: options.sessionSeconds };
}

function progressSavedAt(lastSavedAtRef: { current: number }): number {
  const now = Date.now();
  lastSavedAtRef.current = now;
  return now;
}

function markSessionStarted(
  startedAtRef: { current: number | null },
  event: PlaybackProgressUpdate["event"],
  now: number,
): void {
  if (event === "started") {
    startedAtRef.current ??= now;
  }
}

function markSessionStopped(
  startedAtRef: { current: number | null },
  event: PlaybackProgressUpdate["event"],
): void {
  if (event === "stopped" || event === "completed") {
    startedAtRef.current = null;
  }
}

export function usePlayerProgress(options: PlayerProgressOptions): PlaybackHandlers {
  const { anilistTarget, entry, knownDuration, playbackPosition, resumeAt, timelineOffset } = options;
  const { lastSavedAtRef, savePlayback, startedAtRef } = usePlaybackSaving(anilistTarget);
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
      event !== "started" && event !== "stopped" && !hasMeaningfulPlaybackProgress(position) ||
      !Number.isFinite(duration)
    ) {
      return;
    }
    const now = progressSavedAt(lastSavedAtRef);
    markSessionStarted(startedAtRef, event, now);
    const sessionSeconds = (event === "stopped" || event === "completed") &&
      startedAtRef.current !== null
      ? Math.max(0, (now - startedAtRef.current) / 1000)
      : undefined;
    const progress = progressUpdate({
      rel: entry.rel,
      mediaIdentity: entry.mediaIdentity,
      position,
      duration,
      completed,
      event,
      sessionSeconds,
    });
    savePlayback(anilistTarget === null
      ? progress
      : {
        ...progress,
        anilistMediaId: anilistTarget.mediaId,
        episode: anilistTarget.episode,
        totalEpisodes: anilistTarget.totalEpisodes,
      });
    markSessionStopped(startedAtRef, event);
  }, [anilistTarget, entry.rel, entry.mediaIdentity, knownDuration, lastSavedAtRef, playbackPosition, savePlayback, startedAtRef]);
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
