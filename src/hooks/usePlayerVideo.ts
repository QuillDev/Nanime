import { useCallback, type RefObject, type SyntheticEvent } from "react";
import type { PlaybackHandlers } from "./usePlayerProgress.ts";
import { useVideoBuffering } from "./useVideoBuffering.ts";
import { useVideoControls } from "./useVideoControls.ts";

interface PlayerVideoOptions {
  readonly playbackLocked: boolean;
  readonly knownDuration: number;
  readonly onPlaying: () => void;
  readonly playerRef: RefObject<HTMLDivElement | null>;
  readonly progress: PlaybackHandlers;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  readonly onTimelineSeek: (position: number) => void;
  readonly playbackPosition: (video: HTMLVideoElement) => number;
}

export function usePlayerVideo({
  onPlaying,
  playbackLocked,
  playerRef,
  progress,
  videoRef,
  knownDuration,
  onTimelineSeek,
  playbackPosition,
}: PlayerVideoOptions) {
  const buffering = useVideoBuffering(videoRef);
  const controls = useVideoControls({
    knownDuration,
    playbackLocked,
    onBeforeSeek: buffering.handleBuffering,
    onTimelineSeek,
    playbackPosition,
    playerRef,
    videoRef,
  });
  const handlePlayerPlaying = useCallback(() => {
    buffering.handleReady();
    onPlaying();
  }, [buffering, onPlaying]);
  const handlePlayerTimeUpdate = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    buffering.handleProgressing(event);
    progress.handleTimeUpdate(event);
    controls.handleTimeUpdate(event);
  }, [buffering, controls, progress]);
  const handlePlayerSeeked = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    buffering.handleSeeked(event);
    progress.handleSeeked(event);
  }, [buffering, progress]);
  return {
    ...buffering,
    controls,
    handlePlayerPlaying,
    handlePlayerSeeked,
    handlePlayerTimeUpdate,
  };
}
