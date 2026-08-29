import { describe, expect, test } from "bun:test";
import type { MediaEntry, PlaybackProgressMap } from "../types.ts";
import type { ShowGroup } from "./library.ts";
import { isShowWatched, partitionShowsByWatched } from "./watchedShows.ts";

function entry(show: string, episode: number): MediaEntry {
  return {
    rel: `${show}/episode-${String(episode)}.mkv`,
    name: `Episode ${String(episode)}`,
    folder: show,
    size: 1,
    direct: false,
  };
}

function showGroup(name: string, entries: readonly MediaEntry[]): ShowGroup {
  return {
    name,
    sourceNames: [name],
    seasons: [{ name: "Episodes", sourceShow: name, entries }],
    entries,
  };
}

function progress(entries: readonly MediaEntry[], completed: boolean): PlaybackProgressMap {
  return Object.fromEntries(entries.map((item, index) => [item.rel, {
    rel: item.rel,
    position: completed ? 1400 : 300,
    duration: 1400,
    completed,
    updatedAt: index + 1,
    dismissedAt: null,
  }]));
}

describe("watched home-screen shows", () => {
  test("requires every available episode to be complete", () => {
    const episodes = [entry("Complete", 1), entry("Complete", 2)];
    const saved = progress(episodes, true);

    expect(isShowWatched(showGroup("Complete", episodes), saved)).toBe(true);
    expect(isShowWatched(showGroup("Complete", episodes), {
      ...saved,
      [episodes[1]?.rel ?? ""]: {
        ...saved[episodes[1]?.rel ?? ""]!,
        completed: false,
      },
    })).toBe(false);
  });

  test("does not treat missing progress or an empty show as watched", () => {
    const episode = entry("Started", 1);

    expect(isShowWatched(showGroup("Started", [episode]), {})).toBe(false);
    expect(isShowWatched(showGroup("Empty", []), {})).toBe(false);
  });

  test("moves completed shows out of the main collection without reordering", () => {
    const alphaEpisodes = [entry("Alpha", 1)];
    const betaEpisodes = [entry("Beta", 1)];
    const gammaEpisodes = [entry("Gamma", 1)];
    const shows = [
      showGroup("Alpha", alphaEpisodes),
      showGroup("Beta", betaEpisodes),
      showGroup("Gamma", gammaEpisodes),
    ];
    const saved = {
      ...progress(alphaEpisodes, true),
      ...progress(gammaEpisodes, true),
    };

    const partition = partitionShowsByWatched(shows, saved);

    expect(partition.unwatched.map((item) => item.name)).toEqual(["Beta"]);
    expect(partition.watched.map((item) => item.name)).toEqual(["Alpha", "Gamma"]);
  });

  test("returns a completed show to the main collection when a new episode appears", () => {
    const first = entry("Ongoing", 1);
    const second = entry("Ongoing", 2);
    const saved = progress([first], true);

    expect(isShowWatched(showGroup("Ongoing", [first]), saved)).toBe(true);
    expect(isShowWatched(showGroup("Ongoing", [first, second]), saved)).toBe(false);
  });
});
