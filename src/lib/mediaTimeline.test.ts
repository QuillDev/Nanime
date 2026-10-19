import { describe, expect, test } from "bun:test";
import {
  absoluteBufferedEnd,
  boundedSeekPosition,
  containsTime,
  hlsTimelineOffset,
  planHlsSeek,
  type TimeRangesLike,
} from "./mediaTimeline.ts";

function ranges(...values: readonly [number, number][]): TimeRangesLike {
  return {
    length: values.length,
    start: (index) => values[index]?.[0] ?? Number.NaN,
    end: (index) => values[index]?.[1] ?? Number.NaN,
  };
}

describe("HLS timeline seeking", () => {
  test("recognizes every seekable range and a small boundary tolerance", () => {
    const seekable = ranges([0, 12], [20, 30]);
    expect(containsTime(seekable, 12.04)).toBe(true);
    expect(containsTime(seekable, 19)).toBe(false);
    expect(containsTime(seekable, 25)).toBe(true);
  });

  test("seeks locally only when the absolute target is in the active HLS window", () => {
    const seekable = ranges([0, 30]);
    expect(planHlsSeek(122, 120, seekable)).toEqual({ kind: "local", time: 2 });
    expect(planHlsSeek(300, 120, seekable)).toEqual({ kind: "restart" });
    expect(planHlsSeek(90, 120, seekable)).toEqual({ kind: "restart" });
  });

  test("restarts when the media element has not exposed a seekable window yet", () => {
    expect(planHlsSeek(30, 0, ranges())).toEqual({ kind: "restart" });
  });

  test("reports the absolute buffered edge from the range containing playback", () => {
    const buffered = ranges([0, 4], [8, 22], [30, 40]);
    expect(absoluteBufferedEnd(buffered, 10, 610)).toBe(622);
    expect(absoluteBufferedEnd(buffered, 6, 606)).toBe(606);
  });

  test("clamps relative seeks to the playable timeline", () => {
    expect(boundedSeekPosition(5, -10, 100)).toBe(0);
    expect(boundedSeekPosition(95, 10, 100)).toBe(100);
    expect(boundedSeekPosition(50, 10, 100)).toBe(60);
    expect(boundedSeekPosition(50, 10, Number.NaN)).toBe(0);
  });

  test("sanitizes invalid resume positions before segment alignment", () => {
    expect(hlsTimelineOffset(-20)).toBe(0);
    expect(hlsTimelineOffset(Number.POSITIVE_INFINITY)).toBe(0);
    expect(hlsTimelineOffset(9.9)).toBe(8);
  });
});
