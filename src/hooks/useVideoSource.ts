import { useCallback, useRef, useState, type SyntheticEvent } from "react";
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

interface SourceAttachment {
  readonly video: HTMLVideoElement;
  readonly entry: MediaEntry;
  readonly resumeAt: number;
  readonly onError: (message: string) => void;
}

function attachSource(options: SourceAttachment): (() => void) | undefined {
  const { video, entry, resumeAt, onError } = options;
  if (entry.direct) {
    video.src = streamUrl(entry.rel);
    tryPlay(video);
    return undefined;
  }
  return attachHls({ video, url: hlsUrl(entry.rel), onError, resumeAt });
}

function mediaErrorName(code: number): string {
  switch (code) {
    case 1: {
      return "MEDIA_ERR_ABORTED";
    }
    case 2: {
      return "MEDIA_ERR_NETWORK";
    }
    case 3: {
      return "MEDIA_ERR_DECODE";
    }
    case 4: {
      return "MEDIA_ERR_SRC_NOT_SUPPORTED";
    }
    default: {
      return "MEDIA_ERR_UNKNOWN";
    }
  }
}

function videoErrorDetail(video: HTMLVideoElement): string {
  const { error } = video;
  const code = error?.code ?? 0;
  const name = mediaErrorName(code);
  const message = error?.message.trim() ?? "";
  return [
    "Video playback failed.",
    `MediaError: ${name} (${String(code)})${message === "" ? "" : ` — ${message}`}`,
    `Network state: ${String(video.networkState)}`,
    `Ready state: ${String(video.readyState)}`,
    `Current time: ${String(video.currentTime)}`,
    `Source: ${video.currentSrc || video.src || "Unavailable"}`,
    `Browser: ${navigator.userAgent}`,
    `Time: ${new Date().toISOString()}`,
  ].join("\n");
}

interface VideoSourceState {
  readonly playbackError: string | null;
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  readonly setVideo: (video: HTMLVideoElement | null) => (() => void) | undefined;
  readonly handleVideoError: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handlePlaying: () => void;
  readonly handleAudioTrack: (index: number) => void;
}

export function useVideoSource(entry: MediaEntry, resumeAt: number): VideoSourceState {
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detachRef = useRef<(() => void) | undefined>(undefined);
  const initialSourceRef = useRef({ entry, resumeAt });
  const setVideo = useCallback(
    (video: HTMLVideoElement | null): (() => void) | undefined => {
      if (video === null) {
        return undefined;
      }
      videoRef.current = video;
      try {
        const initialSource = initialSourceRef.current;
        const detachSource = attachSource({ video, ...initialSource, onError: setPlaybackError });
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
    [],
  );
  const handleVideoError = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    setPlaybackError(videoErrorDetail(event.currentTarget));
  }, []);
  const handlePlaying = useCallback(() => {
    setPlaybackError(null);
  }, []);
  const handleAudioTrack = useCallback((index: number) => {
    const video = videoRef.current;
    if (video === null) {
      return;
    }
    const currentPosition = video.currentTime;
    const shouldPlay = !video.paused;
    detachRef.current?.();
    setPlaybackError(null);
    detachRef.current = attachHls({
      video,
      url: hlsUrl(entry.rel, index),
      onError: setPlaybackError,
      resumeAt: currentPosition,
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
