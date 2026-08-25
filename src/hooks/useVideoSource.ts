import { useCallback, useRef, useState, type SyntheticEvent } from "react";
import { hlsUrl, streamUrl } from "../api.ts";
import type { MediaEntry } from "../types.ts";
import type { HlsAttachment } from "../lib/hlsPlayback.ts";
import { HLS_SEGMENT_SECONDS } from "../../shared/playback.ts";

function hlsTimelineOffset(position: number): number {
  return Math.floor(position / HLS_SEGMENT_SECONDS) * HLS_SEGMENT_SECONDS;
}

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
  const { video, url, onError, resumeAt = 0, shouldPlay = true, timelineOffset = 0 } = options;
  if (video.canPlayType("application/vnd.apple.mpegurl") === "") {
    onError("This browser does not support HLS video playback.");
    return;
  }
  video.src = url;
  if (shouldPlay) {
    tryPlay(video);
  }
  const handleMetadata = (): void => {
    // Native HLS engines default an unfinished playlist to its moving live edge.
    // Always choose the requested VOD position, including the start of a new episode.
    video.currentTime = Math.max(0, resumeAt - timelineOffset);
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
  const timelineOffset = hlsTimelineOffset(resumeAt);
  return attachHls({
    video,
    url: hlsUrl(entry.rel, null, resumeAt),
    onError,
    resumeAt,
    timelineOffset,
  });
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
  readonly handleTimelineSeek: (position: number) => boolean;
  readonly timelineOffset: number;
}

interface MutableSourceState {
  detach: (() => void) | undefined;
  selectedAudio: number | null;
  timelineOffset: number;
  video: HTMLVideoElement | null;
}

interface RestartOptions {
  readonly audioTrack: number | null;
  readonly entry: MediaEntry;
  readonly position: number;
  readonly setError: (error: string | null) => void;
  readonly setOffset: (offset: number) => void;
  readonly source: MutableSourceState;
}

function stopSource(source: MutableSourceState, setError: (error: string | null) => void): void {
  source.detach?.();
  setError(null);
}

function restartHls(options: RestartOptions): void {
  const { audioTrack, entry, position, setError, setOffset, source } = options;
  const { video } = source;
  if (video === null) {
    return;
  }
  const timelineOffset = hlsTimelineOffset(position);
  const shouldPlay = !video.paused;
  stopSource(source, setError);
  Object.assign(source, { selectedAudio: audioTrack, timelineOffset });
  setOffset(timelineOffset);
  source.detach = attachHls({
    video,
    url: hlsUrl(entry.rel, audioTrack, position),
    onError: setError,
    resumeAt: position,
    shouldPlay,
    timelineOffset,
  });
}

function cleanupSource(
  source: MutableSourceState,
  videoRef: React.RefObject<HTMLVideoElement | null>,
): void {
  videoRef.current = null;
  source.detach?.();
  Object.assign(source, { detach: undefined, video: null });
}

function usePlaybackErrorHandlers(setError: (error: string | null) => void) {
  const handleVideoError = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    setError(videoErrorDetail(event.currentTarget));
  }, [setError]);
  const handlePlaying = useCallback(() => setError(null), [setError]);
  return { handleVideoError, handlePlaying };
}

export function useVideoSource(entry: MediaEntry, resumeAt: number): VideoSourceState {
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [timelineOffset, setTimelineOffset] = useState(
    entry.direct ? 0 : hlsTimelineOffset(resumeAt),
  );
  const sourceRef = useRef<MutableSourceState>({
    detach: undefined,
    selectedAudio: null,
    timelineOffset,
    video: null,
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const initialSourceRef = useRef({ entry, resumeAt });
  const setVideo = useCallback(
    (video: HTMLVideoElement | null): (() => void) | undefined => {
      if (video === null) {
        return undefined;
      }
      videoRef.current = video;
      sourceRef.current.video = video;
      try {
        const detachSource = attachSource({
          video,
          ...initialSourceRef.current,
          onError: setPlaybackError,
        });
        sourceRef.current.detach = detachSource;
        return () => cleanupSource(sourceRef.current, videoRef);
      } catch (error: unknown) {
        setPlaybackError(
          error instanceof Error ? error.message : "Failed to start playback.",
        );
        return undefined;
      }
    },
    [],
  );
  const { handleVideoError, handlePlaying } = usePlaybackErrorHandlers(setPlaybackError);
  const handleAudioTrack = useCallback((index: number) => {
    const { video } = sourceRef.current;
    if (video === null) {
      return;
    }
    restartHls({
      audioTrack: index,
      entry,
      position: video.currentTime + sourceRef.current.timelineOffset,
      setError: setPlaybackError,
      setOffset: setTimelineOffset,
      source: sourceRef.current,
    });
  }, [entry]);
  const handleTimelineSeek = useCallback((position: number): boolean => {
    const { video } = sourceRef.current;
    if (entry.direct || video === null) {
      return false;
    }
    const offset = sourceRef.current.timelineOffset;
    if (position >= offset && position < offset + video.duration) {
      return false;
    }
    restartHls({
      audioTrack: sourceRef.current.selectedAudio,
      entry,
      position,
      setError: setPlaybackError,
      setOffset: setTimelineOffset,
      source: sourceRef.current,
    });
    return true;
  }, [entry]);
  return {
    playbackError,
    videoRef,
    setVideo,
    handleVideoError,
    handlePlaying,
    handleAudioTrack,
    handleTimelineSeek,
    timelineOffset,
  };
}
