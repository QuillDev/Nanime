import { useCallback, useRef, useState } from "react";
import Hls from "hls.js";
import { hlsUrl, streamUrl } from "../api.ts";
import type { MediaEntry } from "../types.ts";

function tryPlay(video: HTMLVideoElement): void {
  void (async (): Promise<void> => {
    try {
      await video.play();
    } catch {
      // Autoplay may be blocked by the browser; the user can press play.
    }
  })();
}

interface HlsAttachment {
  readonly video: HTMLVideoElement;
  readonly url: string;
  readonly onError: (message: string) => void;
  readonly resumeAt?: number;
  readonly shouldPlay?: boolean;
}

function bindHlsEvents(hls: Hls, options: HlsAttachment): void {
  const { video, onError, resumeAt = 0, shouldPlay = true } = options;
  let recoveredMediaError = false;
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    if (resumeAt > 0) {
      video.currentTime = resumeAt;
    }
    if (shouldPlay) {
      tryPlay(video);
    }
  });
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) {
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMediaError) {
      recoveredMediaError = true;
      hls.recoverMediaError();
      return;
    }
    onError(`Playback failed: ${data.details}.`);
  });
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

function attachHls(options: HlsAttachment): (() => void) | undefined {
  const { video, url } = options;
  if (!Hls.isSupported()) {
    attachNativeHls(options);
    return undefined;
  }
  const hls = new Hls({ enableWorker: true });
  bindHlsEvents(hls, options);
  hls.loadSource(url);
  hls.attachMedia(video);
  return () => {
    hls.destroy();
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
