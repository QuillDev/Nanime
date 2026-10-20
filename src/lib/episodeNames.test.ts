import { expect, test } from "bun:test";
import type { AniListMedia, MediaEntry } from "../types.ts";
import { episodeMetadata, episodeNumber } from "./anilist.ts";
import { seasonRenamePlan } from "./episodeNames.ts";
import { groupShows, seasonDisplayName, seasonNumber } from "./library.ts";

const RELEASE = "[Group] Lantern Keepers (Season 02) [1080p]";

function entry(folder: string, name: string): MediaEntry {
  return { rel: `${folder}/${name}`, name, folder, size: 1, direct: false };
}

function media(english: string, episodes: readonly string[]): AniListMedia {
  return {
    provider: "anilist", id: 42, anilistId: 42, idMal: null,
    title: { english, romaji: english, native: null }, description: null,
    coverImage: { extraLarge: null, large: null, color: null }, bannerImage: null,
    episodes: 12, duration: 24, season: null, seasonYear: 2026, startDate: null, format: "TV", status: null,
    genres: [], averageScore: null, siteUrl: "https://example.invalid",
    streamingEpisodes: episodes.map((title, index) => ({ title: `Episode ${String(index + 1)} - ${title}`, thumbnail: null, site: "Example" })),
  };
}

function onlySeason(entries: readonly MediaEntry[]) {
  const [show] = groupShows(entries);
  const [season] = show?.seasons ?? [];
  if (season === undefined) {
    throw new Error("no season");
  }
  return season;
}

test("an organized file names and numbers its own episode, even with fetched titles", () => {
  const organized = entry("Lantern Keepers/002. Lantern Keepers Season 2", "013. A Better Title.mkv");
  const fetched = media("Lantern Keepers Season 2", Array.from({ length: 13 }, (_, index) => `Fetched ${String(index + 1)}`));

  expect(episodeNumber(organized)).toBe(13);
  expect(episodeMetadata(organized, fetched)?.title).toBe("A Better Title");
  expect(episodeMetadata(organized, undefined)?.title).toBe("A Better Title");
});

test("an organized season folder sets its number and drops it from the shown name", () => {
  const season = onlySeason([entry("Lantern Keepers/003. Keepers Abroad", "001. Departure.mkv")]);

  expect(seasonNumber(season, undefined)).toBe(3);
  expect(seasonDisplayName(season)).toBe("Keepers Abroad");
});

test("organizing a release folder nests it in its show and numbers every episode", () => {
  const season = onlySeason([
    entry(RELEASE, "[Group] Lantern Keepers - S02E02.mkv"),
    entry(RELEASE, "[Group] Lantern Keepers - S02E01.mkv"),
  ]);
  const plan = seasonRenamePlan({
    season, media: media("Lantern Keepers Season 2", ["The Lamp Is Lit", "Keepers/Oath"]),
    showMedia: undefined, seasonNumber: 2, fallbackTitle: "Lantern Keepers",
  });

  expect(plan).toEqual({
    folder: RELEASE,
    showFolder: "Lantern Keepers",
    seasonFolder: { from: RELEASE, to: "002. Lantern Keepers Season 2" },
    episodes: [
      { rel: `${RELEASE}/[Group] Lantern Keepers - S02E01.mkv`, from: "[Group] Lantern Keepers - S02E01.mkv", to: "001. The Lamp Is Lit.mkv" },
      { rel: `${RELEASE}/[Group] Lantern Keepers - S02E02.mkv`, from: "[Group] Lantern Keepers - S02E02.mkv", to: "002. Keepers-Oath.mkv" },
    ],
    conflicts: [],
  });
});

test("episodes without a fetched title are numbered as episodes, and an organized season has nothing to do", () => {
  const raw = onlySeason([entry(RELEASE, "[Group] Lantern Keepers - S02E07.mkv")]);
  const done = onlySeason([entry("Lantern Keepers/002. Lantern Keepers", "007. Episode 7.mkv")]);
  const input = { media: undefined, showMedia: undefined, seasonNumber: 2, fallbackTitle: "Lantern Keepers" };

  expect(seasonRenamePlan({ ...input, season: raw })?.episodes.map((episode) => episode.to)).toEqual(["007. Episode 7.mkv"]);
  expect(seasonRenamePlan({ ...input, season: done })).toMatchObject({ showFolder: null, seasonFolder: null, episodes: [] });
});
