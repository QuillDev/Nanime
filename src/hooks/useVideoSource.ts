import { useCallback, useRef, useState, type SyntheticEvent } from "react";
import { hlsUrl, streamUrl } from "../api.ts";
import type { MediaEntry } from "../types.ts";
import type { HlsAttachment } from "../lib/hlsPlayback.ts";
import { planHlsSeek } from "../lib/mediaTimeline.ts";
import { videoErrorDetail } from "../lib/videoError.ts";
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

interface VideoSourceState {
  readonly playbackError: string | null;
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  readonly setVideo: (video: HTMLVideoElement | null) => (() => void) | undefined;
  readonly handleVideoError: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handlePlaying: () => void;
  readonly handleSourceMetadata: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handleAudioTrack: (index: number) => void;
  readonly handleTimelineSeek: (position: number) => void;
  readonly playbackPosition: (video: HTMLVideoElement) => number;
  readonly timelineOffset: number;
}
interface MutableSourceState {
  detach: (() => void) | undefined;
  selectedAudio: number | null;
  pendingPosition: number | null;
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
interface TimelineSeekOptions extends Omit<RestartOptions, "audioTrack"> {
  readonly direct: boolean;
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
  Object.assign(source, { pendingPosition: position, selectedAudio: audioTrack, timelineOffset });
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
function tryLocalHlsSeek(
  source: MutableSourceState,
  video: HTMLVideoElement,
  position: number,
): boolean {
  const plan = planHlsSeek(position, source.timelineOffset, video.seekable);
  if (plan.kind === "restart") {
    return false;
  }
  source.pendingPosition = null;
  video.currentTime = plan.time;
  return true;
}
function seekTimeline(options: TimelineSeekOptions): void {
  const { direct, entry, position, setError, setOffset, source } = options;
  const { video } = source;
  if (video === null) {
    return;
  }
  if (direct) {
    video.currentTime = Math.max(0, position);
    return;
  }
  if (tryLocalHlsSeek(source, video, position)) {
    return;
  }
  restartHls({
    audioTrack: source.selectedAudio,
    entry,
    position,
    setError,
    setOffset,
    source,
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

function usePlaybackErrorHandlers(
  setError: (error: string | null) => void,
  sourceRef: React.RefObject<MutableSourceState>,
) {
  const handleVideoError = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    setError(videoErrorDetail(event.currentTarget));
  }, [setError]);
  const handlePlaying = useCallback(() => {
    sourceRef.current.pendingPosition = null;
    setError(null);
  }, [setError, sourceRef]);
  return { handleVideoError, handlePlaying };
}

function useSourceReferences(entry: MediaEntry, resumeAt: number, timelineOffset: number) {
  const sourceRef = useRef<MutableSourceState>({
    detach: undefined,
    selectedAudio: null,
    pendingPosition: null,
    timelineOffset,
    video: null,
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const initialSourceRef = useRef({ entry, resumeAt });
  return { sourceRef, videoRef, initialSourceRef };
}

export function useVideoSource(entry: MediaEntry, resumeAt: number): VideoSourceState {
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [timelineOffset, setTimelineOffset] = useState(
    entry.direct ? 0 : hlsTimelineOffset(resumeAt),
  );
  const { sourceRef, videoRef, initialSourceRef } = useSourceReferences(
    entry,
    resumeAt,
    timelineOffset,
  );
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
    [initialSourceRef, sourceRef, videoRef],
  );
  const { handleVideoError, handlePlaying } = usePlaybackErrorHandlers(
    setPlaybackError,
    sourceRef,
  );
  const playbackPosition = useCallback((video: HTMLVideoElement): number => (
    sourceRef.current.pendingPosition ?? video.currentTime + sourceRef.current.timelineOffset
  ), [sourceRef]);
  const handleSourceMetadata = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const source = sourceRef.current;
    if (source.pendingPosition === null) {
      return;
    }
    event.currentTarget.currentTime = Math.max(0, source.pendingPosition - source.timelineOffset);
  }, [sourceRef]);
  const handleAudioTrack = useCallback((index: number) => {
    const { video } = sourceRef.current;
    if (video === null) {
      return;
    }
    restartHls({
      audioTrack: index,
      entry,
      position: playbackPosition(video),
      setError: setPlaybackError,
      setOffset: setTimelineOffset,
      source: sourceRef.current,
    });
  }, [entry, playbackPosition, sourceRef]);
  const handleTimelineSeek = useCallback((position: number): void => {
    seekTimeline({
      direct: entry.direct,
      entry,
      position,
      setError: setPlaybackError,
      setOffset: setTimelineOffset,
      source: sourceRef.current,
    });
  }, [entry, sourceRef]);
  return {
    playbackError,
    videoRef,
    setVideo,
    handleVideoError,
    handlePlaying,
    handleSourceMetadata,
    handleAudioTrack,
    handleTimelineSeek,
    playbackPosition,
    timelineOffset,
  };
}
