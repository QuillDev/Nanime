import {
  useCallback,
  useEffect,
  useState,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { usePlayerFullscreen } from "./usePlayerFullscreen.ts";

interface VideoControlState {
  readonly bufferedUntil: number;
  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly muted: boolean;
  readonly volume: number;
}
export interface VideoControls extends VideoControlState {
  readonly fullscreenError: string | null;
  readonly fullscreen: boolean;
  readonly handleDurationChange: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handleProgress: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handleTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handlePlay: () => void;
  readonly handlePause: () => void;
  readonly handleTogglePlayback: () => void;
  readonly handleSeek: (time: number) => void;
  readonly handleSeekBy: (seconds: number) => void;
  readonly handleVolume: (volume: number) => void;
  readonly handleToggleMuted: () => void;
  readonly handleToggleFullscreen: () => void;
}
const INITIAL_STATE: VideoControlState = {
  bufferedUntil: 0,
  currentTime: 0,
  duration: 0,
  paused: true,
  muted: false,
  volume: 1,
};
function finiteDuration(video: HTMLVideoElement): number {
  return Number.isFinite(video.duration) ? video.duration : 0;
}

function bufferedUntil(video: HTMLVideoElement, timelineOffset: number): number {
  const { buffered, currentTime } = video;
  let index = 0;
  while (index < buffered.length) {
    if (buffered.start(index) <= currentTime && buffered.end(index) >= currentTime) {
      return buffered.end(index) + timelineOffset;
    }
    index += 1;
  }
  return currentTime + timelineOffset;
}
function useVideoState(timelineOffset: number, knownDuration: number) {
  const [state, setState] = useState<VideoControlState>(INITIAL_STATE);
  const handleDurationChange = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    setState((current) => ({
      ...current,
      bufferedUntil: bufferedUntil(video, timelineOffset),
      currentTime: video.currentTime + timelineOffset,
      duration: Math.max(finiteDuration(video) + timelineOffset, knownDuration),
    }));
  }, [knownDuration, timelineOffset]);
  const handleTimeUpdate = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    setState((current) => ({
      ...current,
      bufferedUntil: bufferedUntil(video, timelineOffset),
      currentTime: video.currentTime + timelineOffset,
    }));
  }, [timelineOffset]);
  const handleProgress = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    setState((current) => ({ ...current, bufferedUntil: bufferedUntil(video, timelineOffset) }));
  }, [timelineOffset]);
  const handlePlay = useCallback(() => {
    setState((current) => ({ ...current, paused: false }));
  }, []);
  const handlePause = useCallback(() => {
    setState((current) => ({ ...current, paused: true }));
  }, []);
  return {
    state: { ...state, duration: Math.max(state.duration, knownDuration) },
    setState,
    handleDurationChange,
    handleTimeUpdate,
    handleProgress,
    handlePlay,
    handlePause,
  };
}


function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "SELECT" ||
    target.tagName === "TEXTAREA"
  );
}

function useKeyboardSeeking(onSeekBy: (seconds: number) => void): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onSeekBy(-10);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onSeekBy(10);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onSeekBy]);
}

interface VideoControlsOptions {
  readonly knownDuration: number;
  readonly onBeforeSeek: () => void;
  readonly onTimelineSeek: (position: number) => boolean;
  readonly playerRef: RefObject<HTMLDivElement | null>;
  readonly timelineOffset: number;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
}

export function useVideoControls(options: VideoControlsOptions): VideoControls {
  const {
    knownDuration,
    onBeforeSeek,
    onTimelineSeek,
    playerRef,
    timelineOffset,
    videoRef,
  } = options;
  const playback = useVideoState(timelineOffset, knownDuration);
  const handleTogglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (video === null) {
      return;
    }
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }, [videoRef]);
  const handleSeek = useCallback((time: number) => {
    if (videoRef.current !== null) {
      onBeforeSeek();
      if (!onTimelineSeek(time)) {
        videoRef.current.currentTime = Math.max(0, time - timelineOffset);
      }
      playback.setState((current) => ({ ...current, currentTime: time }));
    }
  }, [onBeforeSeek, onTimelineSeek, playback, timelineOffset, videoRef]);
  const handleSeekBy = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (video !== null) {
      handleSeek(Math.min(
        Math.max(video.currentTime + timelineOffset + seconds, timelineOffset),
        playback.state.duration,
      ));
    }
  }, [handleSeek, playback.state.duration, timelineOffset, videoRef]);
  useKeyboardSeeking(handleSeekBy);
  const handleVolume = useCallback((volume: number) => {
    if (videoRef.current !== null) {
      videoRef.current.volume = volume;
      videoRef.current.muted = volume === 0;
    }
    playback.setState((current) => ({ ...current, volume, muted: volume === 0 }));
  }, [playback, videoRef]);
  const handleToggleMuted = useCallback(() => {
    const video = videoRef.current;
    if (video === null) {
      return;
    }
    video.muted = !video.muted;
    playback.setState((current) => ({ ...current, muted: video.muted }));
  }, [playback, videoRef]);
  const { fullscreen, fullscreenError, handleToggleFullscreen } = usePlayerFullscreen(
    playerRef,
    videoRef,
  );

  return {
    ...playback.state,
    fullscreen,
    fullscreenError,
    handleDurationChange: playback.handleDurationChange,
    handleProgress: playback.handleProgress,
    handleTimeUpdate: playback.handleTimeUpdate,
    handlePlay: playback.handlePlay,
    handlePause: playback.handlePause,
    handleTogglePlayback,
    handleSeek,
    handleSeekBy,
    handleVolume,
    handleToggleMuted,
    handleToggleFullscreen,
  };
}
