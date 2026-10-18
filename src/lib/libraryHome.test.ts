import { expect, test } from "bun:test";
import type { AniListMedia, MediaEntry, ShowMetadata } from "../types.ts";
import type { ShowGroup } from "./library.ts";
import { recentlyAddedShows, RECENT_ROW_MIN_SHOWS, showFacts, sortShows } from "./libraryHome.ts";

function show(name: string, addedAt: number): ShowGroup {
  const entries: MediaEntry[] = [{ rel: `${name}/e01.mkv`, name: "e01.mkv", folder: name, size: 1, direct: true, addedAt }];
  return { name, sourceNames: [name], seasons: [{ name, sourceShow: name, entries }], entries };
}

function media(title: string, extra: Partial<AniListMedia> = {}): AniListMedia {
  return {
    provider: "anilist", id: 1, anilistId: null, idMal: null, title: { english: title, romaji: title, native: null },
    description: null, coverImage: { extraLarge: null, large: null, color: null }, bannerImage: null, episodes: 12,
    duration: 24, season: null, seasonYear: 2020, startDate: null, format: "TV", status: "FINISHED", genres: [],
    averageScore: 70, siteUrl: "", streamingEpisodes: [], ...extra,
  };
}

const shows = [show("b-old", 100), show("a-new", 300), show("c-mid", 200)];
const metadata: ShowMetadata = {
  "show:b-old": media("Beta", { seasonYear: 2024, averageScore: 60 }),
  "show:a-new": media("alpha", { seasonYear: 2019, averageScore: 90 }),
  "show:c-mid": media("Gamma", { seasonYear: 2024, averageScore: 75 }),
};
const names = (list: readonly ShowGroup[]) => list.map((item) => item.name);

test("shows sort newest-added first by default", () => {
  expect(names(sortShows(shows, metadata, "added"))).toEqual(["a-new", "c-mid", "b-old"]);
});

test("A–Z sorts by the displayed title, ignoring case", () => {
  expect(names(sortShows(shows, metadata, "title"))).toEqual(["a-new", "b-old", "c-mid"]);
});

test("release year sorts latest first and breaks ties by title", () => {
  expect(names(sortShows(shows, metadata, "year"))).toEqual(["b-old", "c-mid", "a-new"]);
});

test("score sorts best first", () => {
  expect(names(sortShows(shows, metadata, "score"))).toEqual(["a-new", "c-mid", "b-old"]);
});

test("a small library has no separate recently added row", () => {
  expect(recentlyAddedShows(shows, metadata)).toEqual([]);
});

test("a larger library shows its four newest arrivals", () => {
  const many = Array.from({ length: RECENT_ROW_MIN_SHOWS }, (_, index) => show(`s${String(index)}`, index));
  expect(names(recentlyAddedShows(many, {}))).toEqual(["s7", "s6", "s5", "s4"]);
});

test("poster facts name the year and length, or Movie", () => {
  expect(showFacts(media("x"))).toBe("2020 · 12 eps");
  expect(showFacts(media("x", { format: "MOVIE", episodes: 1 }))).toBe("2020 · Movie");
  expect(showFacts(undefined)).toBeNull();
});
