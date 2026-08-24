import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

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

export function usePlayerFullscreen(
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
    if (document.fullscreenEnabled && player !== null) {
      void enterStandardFullscreen(player, setFullscreenError);
      return;
    }
    setFullscreenError(nativeFullscreenError(videoRef.current));
  }, [playerRef, videoRef]);
  useEffect(() => {
    const updateFullscreen = (): void => setFullscreen(document.fullscreenElement === playerRef.current);
    const video = videoRef.current;
    const handleNativeStart = (): void => setFullscreen(true);
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
