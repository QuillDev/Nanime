import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  type SyntheticEvent,
} from "react";

interface VideoControlState {
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
  currentTime: 0,
  duration: 0,
  paused: true,
  muted: false,
  volume: 1,
};

function finiteDuration(video: HTMLVideoElement): number {
  return Number.isFinite(video.duration) ? video.duration : 0;
}

function useVideoState() {
  const [state, setState] = useState<VideoControlState>(INITIAL_STATE);
  const handleDurationChange = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    setState((current) => ({
      ...current,
      currentTime: video.currentTime,
      duration: finiteDuration(video),
    }));
  }, []);
  const handleTimeUpdate = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const { currentTime } = event.currentTarget;
    setState((current) => ({ ...current, currentTime }));
  }, []);
  const handlePlay = useCallback(() => {
    setState((current) => ({ ...current, paused: false }));
  }, []);
  const handlePause = useCallback(() => {
    setState((current) => ({ ...current, paused: true }));
  }, []);
  return { state, setState, handleDurationChange, handleTimeUpdate, handlePlay, handlePause };
}

function setNativeCaptionMode(video: HTMLVideoElement, fullscreen: boolean): void {
  let index = 0;
  while (index < video.textTracks.length) {
    const track = video.textTracks[index];
    if (track !== undefined && fullscreen && track.mode === "hidden") {
      track.mode = "showing";
    } else if (track !== undefined && !fullscreen && track.mode === "showing") {
      track.mode = "hidden";
    }
    index += 1;
  }
}

function enterNativeVideoFullscreen(video: HTMLVideoElement): boolean {
  if (!("webkitEnterFullscreen" in video) || typeof video.webkitEnterFullscreen !== "function") {
    return false;
  }
  setNativeCaptionMode(video, true);
  video.webkitEnterFullscreen();
  return true;
}

function fullscreenErrorDetail(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function exitStandardFullscreen(
  setError: Dispatch<SetStateAction<string | null>>,
): Promise<void> {
  try {
    await document.exitFullscreen();
  } catch (error: unknown) {
    setError(fullscreenErrorDetail(error));
  }
}

async function enterStandardFullscreen(
  player: HTMLDivElement,
  setError: Dispatch<SetStateAction<string | null>>,
): Promise<void> {
  try {
    await player.requestFullscreen();
  } catch (error: unknown) {
    setError(fullscreenErrorDetail(error));
  }
}

function nativeFullscreenError(video: HTMLVideoElement | null): string | null {
  try {
    return video !== null && enterNativeVideoFullscreen(video)
      ? null
      : "Fullscreen is not supported by this browser.";
  } catch (error: unknown) {
    return fullscreenErrorDetail(error);
  }
}

function useFullscreen(
  playerRef: RefObject<HTMLDivElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
) {
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const handleToggleFullscreen = useCallback(() => {
    setFullscreenError(null);
    if (document.fullscreenElement !== null) {
      void exitStandardFullscreen(setFullscreenError);
      return;
    }
    const player = playerRef.current;
    if (
      document.fullscreenEnabled &&
      player !== null &&
      typeof player.requestFullscreen === "function"
    ) {
      void enterStandardFullscreen(player, setFullscreenError);
      return;
    }
    setFullscreenError(nativeFullscreenError(videoRef.current));
  }, [playerRef, videoRef]);
  useEffect(() => {
    const updateFullscreen = (): void => {
      setFullscreen(document.fullscreenElement === playerRef.current);
    };
    const video = videoRef.current;
    const handleNativeStart = (): void => {
      setFullscreen(true);
    };
    const handleNativeEnd = (): void => {
      setFullscreen(false);
      if (video !== null) {
        setNativeCaptionMode(video, false);
      }
    };
    document.addEventListener("fullscreenchange", updateFullscreen);
    video?.addEventListener("webkitbeginfullscreen", handleNativeStart);
    video?.addEventListener("webkitendfullscreen", handleNativeEnd);
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreen);
      video?.removeEventListener("webkitbeginfullscreen", handleNativeStart);
      video?.removeEventListener("webkitendfullscreen", handleNativeEnd);
    };
  }, [playerRef, videoRef]);
  return { fullscreen, fullscreenError, handleToggleFullscreen };
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

export function useVideoControls(
  videoRef: RefObject<HTMLVideoElement | null>,
  playerRef: RefObject<HTMLDivElement | null>,
): VideoControls {
  const playback = useVideoState();
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
      videoRef.current.currentTime = time;
      playback.setState((current) => ({ ...current, currentTime: time }));
    }
  }, [playback, videoRef]);
  const handleSeekBy = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (video !== null) {
      handleSeek(Math.min(Math.max(video.currentTime + seconds, 0), finiteDuration(video)));
    }
  }, [handleSeek, videoRef]);
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
  const { fullscreen, fullscreenError, handleToggleFullscreen } = useFullscreen(
    playerRef,
    videoRef,
  );

  return {
    ...playback.state,
    fullscreen,
    fullscreenError,
    handleDurationChange: playback.handleDurationChange,
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
