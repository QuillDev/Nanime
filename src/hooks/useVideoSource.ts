import { useCallback, useRef, useState } from "react";
import { hlsUrl, streamUrl } from "../api.ts";
import type { MediaEntry } from "../types.ts";
import type { HlsAttachment } from "../lib/hlsPlayback.ts";

function tryPlay(video: HTMLVideoElement): void {
  void (async (): Promise<void> => {
    try {
      await video.play();
    } catch {
      // Autoplay may be blocked by the browser; the user can press play.
    }
  })();
}

function attachNativeHls(options: HlsAttachment): void {
  const { video, url, onError, resumeAt = 0, shouldPlay = true } = options;
  if (video.canPlayType("application/vnd.apple.mpegurl") === "") {
    onError("This browser does not support HLS video playback.");
    return;
  }
  video.src = url;
  const handleMetadata = (): void => {
    if (resumeAt > 0) {
      video.currentTime = resumeAt;
    }
    if (shouldPlay) {
      tryPlay(video);
    }
  };
  video.addEventListener("loadedmetadata", handleMetadata, { once: true });
}

function attachHls(options: HlsAttachment): () => void {
  if (options.video.canPlayType("application/vnd.apple.mpegurl") !== "") {
    attachNativeHls(options);
    return () => undefined;
  }
  let active = true;
  let detach: (() => void) | undefined = undefined;
  void (async (): Promise<void> => {
    try {
      const module = await import("../lib/hlsPlayback.ts");
      if (active) {
        detach = module.attachHls(options);
      }
    } catch (error: unknown) {
      if (active) {
        const detail = error instanceof Error ? error.message : "Unknown loading error";
        options.onError(`Could not load HLS playback support: ${detail}`);
      }
    }
  })();
  return () => {
    active = false;
    detach?.();
  };
}

function attachSource(
  video: HTMLVideoElement,
  entry: MediaEntry,
  onError: (message: string) => void,
): (() => void) | undefined {
  if (entry.direct) {
    video.src = streamUrl(entry.rel);
    tryPlay(video);
    return undefined;
  }
  return attachHls({ video, url: hlsUrl(entry.rel), onError });
}

interface VideoSourceState {
  readonly playbackError: string | null;
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  readonly setVideo: (video: HTMLVideoElement | null) => (() => void) | undefined;
  readonly handleVideoError: () => void;
  readonly handlePlaying: () => void;
  readonly handleAudioTrack: (index: number) => void;
}

export function useVideoSource(entry: MediaEntry): VideoSourceState {
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detachRef = useRef<(() => void) | undefined>(undefined);
  const setVideo = useCallback(
    (video: HTMLVideoElement | null): (() => void) | undefined => {
      if (video === null) {
        return undefined;
      }
      videoRef.current = video;
      try {
        const detachSource = attachSource(video, entry, setPlaybackError);
        detachRef.current = detachSource;
        return () => {
          videoRef.current = null;
          detachRef.current?.();
          detachRef.current = undefined;
        };
      } catch (error: unknown) {
        setPlaybackError(
          error instanceof Error ? error.message : "Failed to start playback.",
        );
        return undefined;
      }
    },
    [entry],
  );
  const handleVideoError = useCallback(() => {
    setPlaybackError("This video could not be played.");
  }, []);
  const handlePlaying = useCallback(() => {
    setPlaybackError(null);
  }, []);
  const handleAudioTrack = useCallback((index: number) => {
    const video = videoRef.current;
    if (video === null) {
      return;
    }
    const resumeAt = video.currentTime;
    const shouldPlay = !video.paused;
    detachRef.current?.();
    setPlaybackError(null);
    detachRef.current = attachHls({
      video,
      url: hlsUrl(entry.rel, index),
      onError: setPlaybackError,
      resumeAt,
      shouldPlay,
    });
  }, [entry.rel]);
  return {
    playbackError,
    videoRef,
    setVideo,
    handleVideoError,
    handlePlaying,
    handleAudioTrack,
  };
}
