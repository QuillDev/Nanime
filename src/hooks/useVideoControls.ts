import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { usePlayerFullscreen } from "./usePlayerFullscreen.ts";
import { absoluteBufferedEnd, boundedSeekPosition } from "../lib/mediaTimeline.ts";

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
  readonly syncIfHidden: () => void;
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

interface VideoStateOptions {
  readonly controlsVisibleRef: RefObject<boolean>;
  readonly durationRef: RefObject<number>;
  readonly knownDuration: number;
  readonly playbackPosition: (video: HTMLVideoElement) => number;
}

function useVideoState({
  controlsVisibleRef,
  durationRef,
  knownDuration,
  playbackPosition,
}: VideoStateOptions) {
  const [state, setState] = useState<VideoControlState>(INITIAL_STATE);
  const handleDurationChange = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const position = playbackPosition(video);
    const bufferedUntil = absoluteBufferedEnd(video.buffered, video.currentTime, position);
    const duration = Math.max(finiteDuration(video) + position - video.currentTime, knownDuration);
    durationRef.current = duration;
    setState((current) => (
      current.bufferedUntil === bufferedUntil &&
      current.currentTime === position &&
      current.duration === duration
        ? current
        : { ...current, bufferedUntil, currentTime: position, duration }
    ));
  }, [durationRef, knownDuration, playbackPosition]);
  const handleTimeUpdate = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    if (!controlsVisibleRef.current) {
      return;
    }
    const video = event.currentTarget;
    const position = playbackPosition(video);
    const bufferedUntil = absoluteBufferedEnd(video.buffered, video.currentTime, position);
    setState((current) => (
      current.bufferedUntil === bufferedUntil && current.currentTime === position
        ? current
        : { ...current, bufferedUntil, currentTime: position }
    ));
  }, [controlsVisibleRef, playbackPosition]);
  const handleProgress = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    if (!controlsVisibleRef.current) {
      return;
    }
    const video = event.currentTarget;
    const position = playbackPosition(video);
    const bufferedUntil = absoluteBufferedEnd(video.buffered, video.currentTime, position);
    setState((current) => (
      current.bufferedUntil === bufferedUntil ? current : { ...current, bufferedUntil }
    ));
  }, [controlsVisibleRef, playbackPosition]);
  const handlePlay = useCallback(() => {
    setState((current) => (current.paused ? { ...current, paused: false } : current));
  }, []);
  const handlePause = useCallback(() => {
    setState((current) => (current.paused ? current : { ...current, paused: true }));
  }, []);
  const duration = Math.max(state.duration, knownDuration);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration, durationRef]);
  return {
    state: { ...state, duration },
    setState,
    handleDurationChange,
    handleTimeUpdate,
    handleProgress,
    handlePlay,
    handlePause,
  };
}

interface VideoControlsOptions {
  readonly controlsVisible: boolean;
  readonly playbackLocked: boolean;
  readonly knownDuration: number;
  readonly onBeforeSeek: () => void;
  readonly onTimelineSeek: (position: number) => void;
  readonly playbackPosition: (video: HTMLVideoElement) => number;
  readonly playerRef: RefObject<HTMLDivElement | null>;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
}

function useControlRefs(controlsVisible: boolean, knownDuration: number) {
  const controlsVisibleRef = useRef(controlsVisible);
  useEffect(() => {
    controlsVisibleRef.current = controlsVisible;
  }, [controlsVisible]);
  const durationRef = useRef(knownDuration);
  return { controlsVisibleRef, durationRef };
}

function useHiddenSync(options: {
  readonly controlsVisibleRef: RefObject<boolean>;
  readonly playbackPosition: (video: HTMLVideoElement) => number;
  readonly setState: React.Dispatch<React.SetStateAction<VideoControlState>>;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
}): () => void {
  const { controlsVisibleRef, playbackPosition, setState, videoRef } = options;
  return useCallback(() => {
    if (controlsVisibleRef.current || videoRef.current === null) {
      return;
    }
    const video = videoRef.current;
    const position = playbackPosition(video);
    const bufferedUntil = absoluteBufferedEnd(video.buffered, video.currentTime, position);
    setState((current) => (
      current.bufferedUntil === bufferedUntil && current.currentTime === position
        ? current
        : { ...current, bufferedUntil, currentTime: position }
    ));
  }, [controlsVisibleRef, playbackPosition, setState, videoRef]);
}

function usePlaybackActions(options: {
  readonly durationRef: RefObject<number>;
  readonly onBeforeSeek: () => void;
  readonly onTimelineSeek: (position: number) => void;
  readonly playbackLocked: boolean;
  readonly playbackPosition: (video: HTMLVideoElement) => number;
  readonly setState: React.Dispatch<React.SetStateAction<VideoControlState>>;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const { durationRef, onBeforeSeek, onTimelineSeek, playbackLocked, playbackPosition, setState, videoRef } = options;
  const handleTogglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (video === null || playbackLocked) {
      return;
    }
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }, [playbackLocked, videoRef]);
  const handleSeek = useCallback((time: number) => {
    if (videoRef.current !== null && !playbackLocked) {
      onBeforeSeek();
      onTimelineSeek(time);
      setState((current) => ({ ...current, currentTime: time }));
    }
  }, [onBeforeSeek, onTimelineSeek, playbackLocked, setState, videoRef]);
  const handleSeekBy = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (video !== null) {
      handleSeek(boundedSeekPosition(playbackPosition(video), seconds, durationRef.current));
    }
  }, [durationRef, handleSeek, playbackPosition, videoRef]);
  const handleVolume = useCallback((volume: number) => {
    if (videoRef.current !== null) {
      videoRef.current.volume = volume;
      videoRef.current.muted = volume === 0;
    }
    setState((current) => ({ ...current, volume, muted: volume === 0 }));
  }, [setState, videoRef]);
  const handleToggleMuted = useCallback(() => {
    const video = videoRef.current;
    if (video === null) {
      return;
    }
    video.muted = !video.muted;
    setState((current) => ({ ...current, muted: video.muted }));
  }, [setState, videoRef]);
  return { handleTogglePlayback, handleSeek, handleSeekBy, handleVolume, handleToggleMuted };
}

export function useVideoControls(options: VideoControlsOptions): VideoControls {
  const { controlsVisible, knownDuration, playbackLocked, onBeforeSeek, onTimelineSeek, playbackPosition, playerRef, videoRef } = options;
  const { controlsVisibleRef, durationRef } = useControlRefs(controlsVisible, knownDuration);
  const playback = useVideoState({ controlsVisibleRef, durationRef, knownDuration, playbackPosition });
  const syncIfHidden = useHiddenSync({ controlsVisibleRef, playbackPosition, setState: playback.setState, videoRef });
  const actions = usePlaybackActions({ durationRef, onBeforeSeek, onTimelineSeek, playbackLocked, playbackPosition, setState: playback.setState, videoRef });
  const { fullscreen, fullscreenError, handleToggleFullscreen } = usePlayerFullscreen(playerRef, videoRef);
  return {
    ...playback.state,
    ...actions,
    fullscreen,
    fullscreenError,
    syncIfHidden,
    handleDurationChange: playback.handleDurationChange,
    handleProgress: playback.handleProgress,
    handleTimeUpdate: playback.handleTimeUpdate,
    handlePlay: playback.handlePlay,
    handlePause: playback.handlePause,
    handleToggleFullscreen,
  };
}
