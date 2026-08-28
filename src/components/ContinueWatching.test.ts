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

function completed(entryValue: MediaEntry, updatedAt: number): PlaybackProgress {
  return { ...saved(entryValue, updatedAt), position: 1400, completed: true };
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

  test("continues with the next episode after the current episode completes", () => {
    const first = entry("Alpha", 1);
    const second = entry("Alpha", 2);
    const progress: PlaybackProgressMap = { [first.rel]: completed(first, 200) };

    const items = buildContinueWatchingItems([group("Alpha", [first, second])], {}, progress);

    expect(items).toMatchObject([{
      dismissRel: first.rel,
      entry: { rel: second.rel },
      kind: "next",
      progress: { rel: second.rel, completed: false, position: 0 },
    }]);
  });

  test("skips episodes already completed while finding what is next", () => {
    const first = entry("Alpha", 1);
    const second = entry("Alpha", 2);
    const third = entry("Alpha", 3);
    const progress: PlaybackProgressMap = {
      [first.rel]: completed(first, 100),
      [second.rel]: completed(second, 200),
    };

    const items = buildContinueWatchingItems(
      [group("Alpha", [first, second, third])],
      {},
      progress,
    );

    expect(items.map((item) => item.entry.rel)).toEqual([third.rel]);
  });

  test("removes a series after its final episode completes", () => {
    const first = entry("Alpha", 1);
    const second = entry("Alpha", 2);
    const progress: PlaybackProgressMap = {
      [first.rel]: completed(first, 100),
      [second.rel]: completed(second, 200),
    };

    expect(buildContinueWatchingItems(
      [group("Alpha", [first, second])],
      {},
      progress,
    )).toEqual([]);
  });
});
