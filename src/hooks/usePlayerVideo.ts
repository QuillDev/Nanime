import { useCallback, type RefObject, type SyntheticEvent } from "react";
import type { PlaybackHandlers } from "./usePlayerProgress.ts";
import { useVideoBuffering } from "./useVideoBuffering.ts";
import { useVideoControls } from "./useVideoControls.ts";

interface PlayerVideoOptions {
  readonly knownDuration: number;
  readonly onPlaying: () => void;
  readonly playerRef: RefObject<HTMLDivElement | null>;
  readonly progress: PlaybackHandlers;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  readonly timelineOffset: number;
  readonly onTimelineSeek: (position: number) => boolean;
}

export function usePlayerVideo({
  onPlaying,
  playerRef,
  progress,
  videoRef,
  timelineOffset,
  knownDuration,
  onTimelineSeek,
}: PlayerVideoOptions) {
  const buffering = useVideoBuffering(videoRef);
  const controls = useVideoControls({
    knownDuration,
    onBeforeSeek: buffering.handleBuffering,
    onTimelineSeek,
    playerRef,
    timelineOffset,
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
