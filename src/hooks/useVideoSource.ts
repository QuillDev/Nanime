import { useCallback, useRef, useState, type SyntheticEvent } from "react";
import { streamUrl } from "../api.ts";
import { hlsUrl } from "../hlsApi.ts";
import type { MediaEntry, PreferredAudioLanguage } from "../types.ts";
import {
  absolutePlaybackPosition,
  hlsTimelineOffset,
  planHlsSeek,
  sourceMetadataPosition,
} from "../lib/mediaTimeline.ts";
import { videoErrorDetail } from "../lib/videoError.ts";
import { attachDirectVideoSource } from "../lib/directVideoPlayback.ts";
import { attachManagedHls } from "../lib/managedHlsPlayback.ts";

interface SourceAttachment {
  readonly video: HTMLVideoElement;
  readonly entry: MediaEntry;
  readonly resumeAt: number;
  readonly onError: (message: string) => void;
  readonly playerId: string;
  readonly direct: boolean;
}
function attachSource(options: SourceAttachment): (() => void) | undefined {
  const { video, entry, resumeAt, onError, playerId, direct } = options;
  if (direct) {
    attachDirectVideoSource(video, entry.offlineUrl ?? streamUrl(entry.rel));
    return undefined;
  }
  const timelineOffset = hlsTimelineOffset(resumeAt);
  return attachManagedHls({
    video,
    url: hlsUrl(entry.rel, null, resumeAt),
    onError,
    resumeAt,
    timelineOffset,
  }, playerId);
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
  readonly playbackMode: "direct" | "hls";
}
interface MutableSourceState {
  detach: (() => void) | undefined;
  selectedAudio: number | null;
  pendingPosition: number | null;
  readonly playerId: string;
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
  source.detach = attachManagedHls({
    video,
    url: hlsUrl(entry.rel, audioTrack, position),
    onError: setError,
    resumeAt: position,
    shouldPlay,
    timelineOffset,
  }, source.playerId);
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
  if (direct && source.selectedAudio === null) {
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

interface SourceReferenceOptions {
  readonly direct: boolean;
  readonly entry: MediaEntry;
  readonly resumeAt: number;
  readonly timelineOffset: number;
}

function useSourceReferences(options: SourceReferenceOptions) {
  const { direct, entry, resumeAt, timelineOffset } = options;
  const sourceRef = useRef<MutableSourceState>({
    detach: undefined,
    selectedAudio: null,
    pendingPosition: null,
    playerId: crypto.randomUUID(),
    timelineOffset,
    video: null,
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const initialSourceRef = useRef({ direct, entry, resumeAt });
  return { sourceRef, videoRef, initialSourceRef };
}

function useInitialSourceState(
  entry: MediaEntry,
  resumeAt: number,
  preferredAudioLanguage: PreferredAudioLanguage | null,
) {
  const direct = entry.offlineUrl !== undefined || entry.direct && preferredAudioLanguage === null;
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [timelineOffset, setTimelineOffset] = useState(
    direct ? 0 : hlsTimelineOffset(resumeAt),
  );
  return { direct, playbackError, setPlaybackError, timelineOffset, setTimelineOffset };
}

export function useVideoSource(
  entry: MediaEntry,
  resumeAt: number,
  preferredAudioLanguage: PreferredAudioLanguage | null,
): VideoSourceState {
  const {
    direct, playbackError, setPlaybackError, timelineOffset, setTimelineOffset,
  } = useInitialSourceState(entry, resumeAt, preferredAudioLanguage);
  const { sourceRef, videoRef, initialSourceRef } = useSourceReferences({
    entry, resumeAt,
    timelineOffset,
    direct,
  });
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
          playerId: sourceRef.current.playerId,
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
    [initialSourceRef, setPlaybackError, sourceRef, videoRef],
  );
  const { handleVideoError, handlePlaying } = usePlaybackErrorHandlers(
    setPlaybackError,
    sourceRef,
  );
  const playbackPosition = useCallback((video: HTMLVideoElement): number => (
    absolutePlaybackPosition(
      video.currentTime,
      sourceRef.current.timelineOffset,
      sourceRef.current.pendingPosition,
    )
  ), [sourceRef]);
  const handleSourceMetadata = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const source = sourceRef.current;
    if (source.pendingPosition === null) {
      return;
    }
    const position = sourceMetadataPosition(source.pendingPosition, source.timelineOffset);
    if (position !== null) {
      event.currentTarget.currentTime = position;
    }
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
  }, [entry, playbackPosition, setPlaybackError, setTimelineOffset, sourceRef]);
  const handleTimelineSeek = useCallback((position: number): void => {
    seekTimeline({
      direct,
      entry,
      position,
      setError: setPlaybackError,
      setOffset: setTimelineOffset,
      source: sourceRef.current,
    });
  }, [direct, entry, setPlaybackError, setTimelineOffset, sourceRef]);
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
    playbackMode: direct ? "direct" : "hls",
  };
}
