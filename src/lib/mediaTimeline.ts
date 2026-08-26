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
