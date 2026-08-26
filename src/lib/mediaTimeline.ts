import { HLS_SEGMENT_SECONDS } from "../../shared/playback.ts";

export interface TimeRangesLike {
  readonly length: number;
  readonly start: (index: number) => number;
  readonly end: (index: number) => number;
}

export type HlsSeekPlan =
  | { readonly kind: "local"; readonly time: number }
  | { readonly kind: "restart" };

export function containsTime(
  ranges: TimeRangesLike,
  time: number,
  tolerance = 0.05,
): boolean {
  for (let index = 0; index < ranges.length; index += 1) {
    if (time >= ranges.start(index) - tolerance && time <= ranges.end(index) + tolerance) {
      return true;
    }
  }
  return false;
}

export function planHlsSeek(
  position: number,
  timelineOffset: number,
  seekable: TimeRangesLike,
): HlsSeekPlan {
  const localTime = position - timelineOffset;
  return localTime >= 0 && containsTime(seekable, localTime)
    ? { kind: "local", time: localTime }
    : { kind: "restart" };
}

export function hlsTimelineOffset(position: number): number {
  const safePosition = Number.isFinite(position) ? Math.max(0, position) : 0;
  return Math.floor(safePosition / HLS_SEGMENT_SECONDS) * HLS_SEGMENT_SECONDS;
}

export function absolutePlaybackPosition(
  localTime: number,
  timelineOffset: number,
  pendingPosition: number | null,
): number {
  return pendingPosition ?? localTime + timelineOffset;
}

export function sourceMetadataPosition(
  pendingPosition: number | null,
  timelineOffset: number,
): number | null {
  return pendingPosition === null ? null : Math.max(0, pendingPosition - timelineOffset);
}

export function absoluteBufferedEnd(
  buffered: TimeRangesLike,
  localTime: number,
  absolutePosition: number,
): number {
  const timelineOffset = absolutePosition - localTime;
  for (let index = 0; index < buffered.length; index += 1) {
    if (buffered.start(index) <= localTime && buffered.end(index) >= localTime) {
      return buffered.end(index) + timelineOffset;
    }
  }
  return absolutePosition;
}

export function boundedSeekPosition(
  position: number,
  seconds: number,
  duration: number,
): number {
  const requested = position + seconds;
  const safeDuration = Number.isFinite(duration) ? Math.max(duration, 0) : 0;
  return Number.isFinite(requested)
    ? Math.min(Math.max(requested, 0), safeDuration)
    : 0;
}
