import { describe, expect, test } from "bun:test";
import type { MediaEntry, PlaybackProgress, PlaybackProgressMap } from "../types.ts";
import { buildProfileEpisodes, groupByDay, profileEpisode, recentlyWatched } from "./profileMedia.ts";

function entry(show: string, episode: number): MediaEntry {
  const name = `${show} - S01E${String(episode).padStart(2, "0")}.mkv`;
  return { rel: `${show}/${name}`, name, folder: show, size: 1, direct: false };
}

function saved(item: MediaEntry, updatedAt: number, overrides: Partial<PlaybackProgress> = {}): PlaybackProgress {
  return { rel: item.rel, position: 300, duration: 1440, completed: false, updatedAt, dismissedAt: null, ...overrides };
}

const kites = [entry("Paper Kites", 1), entry("Paper Kites", 2), entry("Paper Kites", 3)];
const engine = [entry("Quiet Engine", 1), entry("Quiet Engine", 2)];
const episodes = buildProfileEpisodes([...kites, ...engine], {});

describe("recentlyWatched", () => {
  test("lists the newest watched episode of each show, newest first", () => {
    const progress: PlaybackProgressMap = Object.fromEntries([
      saved(kites[0]!, 10, { completed: true }),
      saved(kites[1]!, 30),
      saved(engine[0]!, 20),
    ].map((item) => [item.rel, item]));
    const recent = recentlyWatched(episodes, progress, 4);
    expect(recent.map((item) => [item.episode.showTitle, item.episode.number])).toEqual([
      ["Paper Kites", 2],
      ["Quiet Engine", 1],
    ]);
  });

  test("skips barely started episodes, files no longer in the library, and stops at the limit", () => {
    const gone = entry("Removed Show", 1);
    const progress: PlaybackProgressMap = Object.fromEntries([
      saved(kites[2]!, 50, { position: 1 }),
      saved(gone, 40),
      saved(kites[0]!, 30),
      saved(engine[1]!, 20),
    ].map((item) => [item.rel, item]));
    expect(recentlyWatched(episodes, progress, 1).map((item) => item.episode.rel)).toEqual([kites[0]!.rel]);
  });
});

describe("profileEpisode", () => {
  test("names a file that left the library from its path", () => {
    const gone = entry("Removed Show", 4);
    expect(profileEpisode(episodes, gone.rel)).toMatchObject({ showTitle: "Removed Show", number: 4, thumbnail: null });
  });
});

describe("groupByDay", () => {
  test("groups newest-first events under Today, Yesterday, then their date", () => {
    const now = new Date(2026, 9, 19, 20, 0).getTime();
    const events = [
      { id: 1, createdAt: new Date(2026, 9, 19, 9, 0).getTime() },
      { id: 2, createdAt: new Date(2026, 9, 19, 0, 5).getTime() },
      { id: 3, createdAt: new Date(2026, 9, 18, 23, 59).getTime() },
      { id: 4, createdAt: new Date(2026, 9, 16, 12, 0).getTime() },
    ];
    const groups = groupByDay(events, now);
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([[1, 2], [3], [4]]);
    expect(groups.slice(0, 2).map((group) => group.label)).toEqual(["Today", "Yesterday"]);
    expect(groups[2]?.label).not.toBe("Yesterday");
  });
});
