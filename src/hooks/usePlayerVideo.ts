import { useCallback, type RefObject, type SyntheticEvent } from "react";
import type { PlaybackHandlers } from "./usePlayerProgress.ts";
import { useVideoBuffering } from "./useVideoBuffering.ts";
import { useVideoControls } from "./useVideoControls.ts";

interface PlayerVideoOptions {
  readonly onPlaying: () => void;
  readonly playerRef: RefObject<HTMLDivElement | null>;
  readonly progress: PlaybackHandlers;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
}

export function usePlayerVideo({
  onPlaying,
  playerRef,
  progress,
  videoRef,
}: PlayerVideoOptions) {
  const buffering = useVideoBuffering(videoRef);
  const controls = useVideoControls(videoRef, playerRef, buffering.handleBuffering);
  const handlePlayerPlaying = useCallback(() => {
    buffering.handleReady();
    onPlaying();
  }, [buffering, onPlaying]);
  const handlePlayerSeeked = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    buffering.handleSeeked(event);
    progress.handleSeeked(event);
  }, [buffering, progress]);
  return { ...buffering, controls, handlePlayerPlaying, handlePlayerSeeked };
}
