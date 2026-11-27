import { useCallback, type RefObject, type SyntheticEvent } from "react";
import type { PlaybackHandlers } from "./usePlayerProgress.ts";
import { useVideoBuffering } from "./useVideoBuffering.ts";
import { useVideoControls } from "./useVideoControls.ts";

interface PlayerVideoOptions {
  readonly controlsVisible: boolean;
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
  controlsVisible,
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
  const {
    handleBuffering,
    handleProgressing,
    handleReady,
    handleSeeked: handleBufferingSeeked,
  } = buffering;
  const controls = useVideoControls({
    controlsVisible,
    knownDuration,
    playbackLocked,
    onBeforeSeek: handleBuffering,
    onTimelineSeek,
    playbackPosition,
    playerRef,
    videoRef,
  });
  const { handleTimeUpdate: handleControlsTimeUpdate } = controls;
  const {
    handleSeeked: handleProgressSeeked,
    handleTimeUpdate: handleProgressTimeUpdate,
  } = progress;
  const handlePlayerPlaying = useCallback(() => {
    handleReady();
    onPlaying();
  }, [handleReady, onPlaying]);
  const handlePlayerTimeUpdate = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    handleProgressing(event);
    handleProgressTimeUpdate(event);
    handleControlsTimeUpdate(event);
  }, [handleControlsTimeUpdate, handleProgressTimeUpdate, handleProgressing]);
  const handlePlayerSeeked = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    handleBufferingSeeked(event);
    handleProgressSeeked(event);
  }, [handleBufferingSeeked, handleProgressSeeked]);
  return {
    ...buffering,
    controls,
    handlePlayerPlaying,
    handlePlayerSeeked,
    handlePlayerTimeUpdate,
  };
}
