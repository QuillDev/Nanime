import { describe, expect, test } from "bun:test";
import {
  isPlaybackComplete,
  playbackWatchedState,
  resolvedPlaybackDuration,
} from "./playback.ts";

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

  test("marks an unplayed episode watched without inventing playback time", () => {
    expect(playbackWatchedState({
      rel: "episode.mkv", watched: true, existing: null, updatedAt: 100,
    })).toEqual({
      rel: "episode.mkv",
      position: 0,
      duration: 0,
      completed: true,
      updatedAt: 100,
      dismissedAt: null,
    });
  });

  test("marking an episode unwatched clears its resumable position", () => {
    const existing = {
      rel: "episode.mkv",
      position: 800,
      duration: 1400,
      completed: true,
      updatedAt: 50,
      dismissedAt: null,
    };
    expect(playbackWatchedState({
      rel: "episode.mkv", watched: false, existing, updatedAt: 100,
    })).toEqual({
      ...existing,
      position: 0,
      completed: false,
      updatedAt: 100,
    });
  });
});
