import { describe, expect, test } from "bun:test";
import { isPlaybackComplete, resolvedPlaybackDuration } from "./playback.ts";

describe("playback progress", () => {
  test("uses the known full duration while a live HLS playlist reports infinity", () => {
    expect(resolvedPlaybackDuration({
      mediaDuration: Number.POSITIVE_INFINITY,
      localPosition: 12,
      absolutePosition: 912,
      knownDuration: 1420,
    })).toBe(1420);
  });

  test("converts a finite HLS window duration to an absolute timeline duration", () => {
    expect(resolvedPlaybackDuration({
      mediaDuration: 520,
      localPosition: 12,
      absolutePosition: 912,
      knownDuration: 0,
    })).toBe(1420);
  });

  test("allows a completed title to become resumable during a rewatch", () => {
    expect(isPlaybackComplete(947, 1420, false)).toBe(false);
  });

  test("marks explicit endings and the final playback window complete", () => {
    expect(isPlaybackComplete(1310, 1420, false)).toBe(true);
    expect(isPlaybackComplete(900, 1420, true)).toBe(true);
  });
});
