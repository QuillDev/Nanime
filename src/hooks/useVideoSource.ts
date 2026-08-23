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

function bindHlsEvents(
  hls: Hls,
  video: HTMLVideoElement,
  onError: (message: string) => void,
): void {
  let recoveredMediaError = false;
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    tryPlay(video);
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

function attachNativeHls(
  video: HTMLVideoElement,
  url: string,
  onError: (message: string) => void,
): void {
  if (video.canPlayType("application/vnd.apple.mpegurl") === "") {
    onError("This browser does not support HLS video playback.");
    return;
  }
  video.src = url;
  tryPlay(video);
}

function attachHls(
  video: HTMLVideoElement,
  url: string,
  onError: (message: string) => void,
): (() => void) | undefined {
  if (!Hls.isSupported()) {
    attachNativeHls(video, url, onError);
    return undefined;
  }
  const hls = new Hls({ enableWorker: true });
  bindHlsEvents(hls, video, onError);
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
  return attachHls(video, hlsUrl(entry.rel), onError);
}

export interface VideoSourceState {
  readonly playbackError: string | null;
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  readonly setVideo: (video: HTMLVideoElement | null) => (() => void) | undefined;
  readonly handleVideoError: () => void;
  readonly handlePlaying: () => void;
}

export function useVideoSource(entry: MediaEntry): VideoSourceState {
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const setVideo = useCallback(
    (video: HTMLVideoElement | null): (() => void) | undefined => {
      if (video === null) {
        return undefined;
      }
      videoRef.current = video;
      try {
        const detachSource = attachSource(video, entry, setPlaybackError);
        return () => {
          videoRef.current = null;
          detachSource?.();
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
  return { playbackError, videoRef, setVideo, handleVideoError, handlePlaying };
}
