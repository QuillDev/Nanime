import { describe, expect, test } from "bun:test";
import { containsTime, planHlsSeek, type TimeRangesLike } from "./mediaTimeline.ts";

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
});
