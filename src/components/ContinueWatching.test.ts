import { describe, expect, test } from "bun:test";
import type { MediaEntry, PlaybackProgress, PlaybackProgressMap } from "../types.ts";
import type { ShowGroup } from "../lib/library.ts";
import { buildContinueWatchingItems } from "../lib/continueWatching.ts";

function entry(show: string, episode: number): MediaEntry {
  return {
    rel: `${show}/episode-${String(episode)}.mkv`,
    name: `Episode ${String(episode)}`,
    folder: show,
    size: 1,
    direct: false,
  };
}

function group(name: string, entries: readonly MediaEntry[]): ShowGroup {
  return {
    name,
    sourceNames: [name],
    seasons: [{ name: "Episodes", sourceShow: name, entries }],
    entries,
  };
}

function saved(entryValue: MediaEntry, updatedAt: number): PlaybackProgress {
  return {
    rel: entryValue.rel,
    position: 300,
    duration: 1400,
    completed: false,
    updatedAt,
    dismissedAt: null,
  };
}

describe("Continue Watching selection", () => {
  test("keeps only the most recently updated episode from one series", () => {
    const first = entry("Alpha", 1);
    const second = entry("Alpha", 2);
    const progress: PlaybackProgressMap = {
      [first.rel]: saved(first, 100),
      [second.rel]: saved(second, 200),
    };
    const items = buildContinueWatchingItems([group("Alpha", [first, second])], {}, progress);
    expect(items.map((item) => item.entry.rel)).toEqual([second.rel]);
  });

  test("preserves the latest resumable episode from every series", () => {
    const alpha = entry("Alpha", 2);
    const beta = entry("Beta", 4);
    const progress: PlaybackProgressMap = {
      [alpha.rel]: saved(alpha, 200),
      [beta.rel]: saved(beta, 300),
    };
    const items = buildContinueWatchingItems(
      [group("Alpha", [alpha]), group("Beta", [beta])],
      {},
      progress,
    );
    expect(items.map((item) => item.entry.rel)).toEqual([beta.rel, alpha.rel]);
  });
});
