import { useCallback, useRef, useState, type SyntheticEvent } from "react";
import type { MediaEntry, PreferredAudioLanguage } from "../types.ts";
import {
  absolutePlaybackPosition,
  hlsTimelineOffset,
  sourceMetadataPosition,
} from "../lib/mediaTimeline.ts";
import { videoErrorDetail } from "../lib/videoError.ts";
import {
  decoderFailed,
  playbackErrorHandler,
  restartHls,
  type MutableSourceState,
} from "../lib/videoSourceRestart.ts";
import { initiallyDirect, useSourceSwitching } from "./useConvertedStream.ts";
import { attachSource } from "../lib/videoSourceAttach.ts";

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
  /** The viewer chose the converted stream over the original. */
  readonly converted: boolean;
  readonly handleConverted: (converted: boolean) => void;
}
function cleanupSource(
  source: MutableSourceState,
  videoRef: React.RefObject<HTMLVideoElement | null>,
): void {
  videoRef.current = null;
  source.detach?.();
  Object.assign(source, { detach: undefined, video: null });
}

interface ErrorHandlerOptions {
  readonly entry: MediaEntry;
  readonly setError: (error: string | null) => void;
  readonly setOffset: (offset: number) => void;
  readonly sourceRef: React.RefObject<MutableSourceState>;
}

function usePlaybackErrorHandlers({ entry, setError, setOffset, sourceRef }: ErrorHandlerOptions) {
  const handleVideoError = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    // A decoder that can't play the untouched video gets the converted stream instead of an error.
    const report = playbackErrorHandler({ entry, setError, setOffset, source: sourceRef.current });
    report(videoErrorDetail(event.currentTarget), decoderFailed(event.currentTarget) ? "media" : undefined);
  }, [entry, setError, setOffset, sourceRef]);
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
    hiddenAt: null,
    recoveryPending: false,
    selectedAudio: null,
    pendingPosition: null,
    passthroughCodec: null,
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
  const direct = initiallyDirect(entry, preferredAudioLanguage);
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
  const initial = useInitialSourceState(entry, resumeAt, preferredAudioLanguage);
  const { playbackError, setPlaybackError, timelineOffset, setTimelineOffset } = initial;
  const { sourceRef, videoRef, initialSourceRef } = useSourceReferences({
    entry, resumeAt,
    timelineOffset,
    direct: initial.direct,
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
          onError: playbackErrorHandler({ entry: initialSourceRef.current.entry, setError: setPlaybackError, setOffset: setTimelineOffset, source: sourceRef.current }),
          onTimelineOffset: (offset) => {
            sourceRef.current.timelineOffset = offset;
            setTimelineOffset(offset);
          },
          onPassthroughCodec: (codec) => {
            sourceRef.current.passthroughCodec = codec;
          },
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
    [initialSourceRef, setPlaybackError, setTimelineOffset, sourceRef, videoRef],
  );
  const { handleVideoError, handlePlaying } = usePlaybackErrorHandlers({
    entry, setError: setPlaybackError, setOffset: setTimelineOffset, sourceRef,
  });
  const playbackPosition = useCallback((video: HTMLVideoElement): number => (
    absolutePlaybackPosition(
      video.currentTime,
      sourceRef.current.timelineOffset,
      sourceRef.current.pendingPosition,
    )
  ), [sourceRef]);
  const { converted, direct, handleConverted, handleTimelineSeek } = useSourceSwitching({
    entry, preferredAudioLanguage, playbackPosition, setError: setPlaybackError, setOffset: setTimelineOffset, sourceRef,
  });
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
    converted,
    handleConverted,
  };
}
