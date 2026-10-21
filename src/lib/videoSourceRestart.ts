import { hlsUrl } from "../hlsApi.ts";
import type { MediaEntry } from "../types.ts";
import { absolutePlaybackPosition, hlsTimelineOffset } from "./mediaTimeline.ts";
import { attachManagedHls } from "./managedHlsPlayback.ts";
import { markCodecUnplayable } from "./hevcPlayback.ts";

export interface MutableSourceState {
  detach: (() => void) | undefined;
  hiddenAt: number | null;
  recoveryPending: boolean;
  selectedAudio: number | null;
  pendingPosition: number | null;
  readonly playerId: string;
  /** The codec the current session streams untouched, or null when it's converted. */
  passthroughCodec: string | null;
  timelineOffset: number;
  video: HTMLVideoElement | null;
}

export interface RestartOptions {
  readonly audioTrack: number | null;
  readonly entry: MediaEntry;
  readonly position: number;
  readonly setError: (error: string | null) => void;
  readonly setOffset: (offset: number) => void;
  readonly source: MutableSourceState;
  /** Play once restarted; by default only if the video was playing. */
  readonly play?: boolean;
}

function stopSource(source: MutableSourceState, setError: (error: string | null) => void): void {
  source.detach?.();
  setError(null);
}

/** The video element's error means its decoder (or the browser's support) failed, not loading. */
export function decoderFailed(video: HTMLVideoElement): boolean {
  const code = video.error?.code;
  return code === MediaError.MEDIA_ERR_DECODE || code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
}

/** Reports playback errors, except a decoder failure on untouched video, which falls back instead. */
export function playbackErrorHandler(options: Omit<RestartOptions, "audioTrack" | "position">): (message: string, kind?: "media") => void {
  return (message, kind) => {
    const { video } = options.source;
    const position = video === null ? 0 : absolutePlaybackPosition(video.currentTime, options.source.timelineOffset, options.source.pendingPosition);
    if (!fallBackFromPassthrough({ ...options, position }, kind === "media")) {
      options.setError(message);
    }
  };
}

export function restartHls(options: RestartOptions): void {
  const { audioTrack, entry, position, setError, setOffset, source } = options;
  const { video } = source;
  if (video === null) {
    return;
  }
  const timelineOffset = hlsTimelineOffset(position);
  const shouldPlay = options.play ?? !video.paused;
  stopSource(source, setError);
  Object.assign(source, { pendingPosition: position, selectedAudio: audioTrack, timelineOffset });
  setOffset(timelineOffset);
  source.detach = attachManagedHls({
    video,
    url: hlsUrl(entry.rel, audioTrack, position),
    onError: playbackErrorHandler({ entry, setError, setOffset, source }),
    resumeAt: position,
    shouldPlay,
    timelineOffset,
    onTimelineOffset: (offset) => {
      source.timelineOffset = offset;
      setOffset(offset);
    },
    onPassthroughCodec: (codec) => {
      source.passthroughCodec = codec;
    },
  }, source.playerId);
}

/**
 * The device's decoder failed on video it said it could decode untouched:
 * remember that, and pick playback back up from the same spot with the
 * converted stream. False when there's nothing to fall back from.
 */
export function fallBackFromPassthrough(options: Omit<RestartOptions, "audioTrack">, decodeFailed: boolean): boolean {
  const { source } = options;
  const codec = source.passthroughCodec;
  if (codec === null || !decodeFailed) {
    return false;
  }
  markCodecUnplayable(codec);
  source.passthroughCodec = null;
  // The failed decoder stopped playback the viewer had started; pick it back up.
  restartHls({ ...options, audioTrack: source.selectedAudio, play: true });
  return true;
}
