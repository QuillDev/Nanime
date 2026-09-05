import { expect, test } from "bun:test";
import { watchTogetherPosition, type WatchTogetherState } from "./watchTogether.ts";

const state: WatchTogetherState = {
  id: "example", rel: "Example/episode.mp4", position: 30,
  paused: false, rate: 1, updatedAt: 1000, serverTime: 2000,
};

test("projects host position using server age and local elapsed time", () => {
  expect(watchTogetherPosition(state, 500)).toBe(31.5);
  expect(watchTogetherPosition({ ...state, rate: 2 }, 500)).toBe(33);
});

test("paused playback stays fixed and stale playback is bounded", () => {
  expect(watchTogetherPosition({ ...state, paused: true }, 5000)).toBe(30);
  expect(watchTogetherPosition(state, 60_000)).toBe(45);
  expect(watchTogetherPosition(state, -5000)).toBe(30);
});
