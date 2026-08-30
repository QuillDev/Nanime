import { describe, expect, test } from "bun:test";
import type { MediaEntry, PlaybackProgressMap } from "../types.ts";
import { isSeasonWatched, seasonWatchedUpdates } from "./seasonWatched.ts";

function entry(episode: number): MediaEntry {
  return {
    rel: `Example/Season 1/Episode ${String(episode)}.mkv`,
    name: `Episode ${String(episode)}`,
    folder: "Example/Season 1",
    size: 1,
    direct: false,
  };
}

function completedProgress(entries: readonly MediaEntry[]): PlaybackProgressMap {
  return Object.fromEntries(entries.map((item, index) => [item.rel, {
    rel: item.rel,
    position: 1400,
    duration: 1400,
    completed: true,
    updatedAt: index + 1,
    dismissedAt: null,
  }]));
}

describe("season watched actions", () => {
  test("only reports a non-empty, fully completed season as watched", () => {
    const entries = [entry(1), entry(2)];
    const progress = completedProgress(entries);

    expect(isSeasonWatched(entries, progress)).toBe(true);
    expect(isSeasonWatched(entries, {
      ...progress,
      [entries[1]?.rel ?? ""]: {
        ...progress[entries[1]?.rel ?? ""]!,
        completed: false,
      },
    })).toBe(false);
    expect(isSeasonWatched(entries, {})).toBe(false);
    expect(isSeasonWatched([], {})).toBe(false);
  });

  test("marks episodes watched from first to last", () => {
    const entries = [entry(1), entry(2), entry(3)];

    expect(seasonWatchedUpdates(entries, undefined, true)).toEqual(entries.map((item) => ({
      rel: item.rel,
      watched: true,
      origin: "season-menu",
    })));
  });

  test("marks episodes unwatched from last to first for safe list-progress rollback", () => {
    const entries = [entry(1), entry(2), entry(3)];

    expect(seasonWatchedUpdates(entries, undefined, false)).toEqual(
      entries.toReversed().map((item) => ({
        rel: item.rel,
        watched: false,
        origin: "season-menu",
      })),
    );
  });
});
