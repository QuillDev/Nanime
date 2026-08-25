import { expect, test } from "bun:test";
import type { AniListMedia, MediaEntry, ShowMetadata } from "../types.ts";
import {
  groupShows,
  isMovieMedia,
  primaryShowMetadata,
  seasonMetadataKey,
  showMetadataKey,
  sortShowsByAirDate,
} from "./library.ts";

function entry(folder: string): MediaEntry {
  return {
    rel: `${folder}/video.mkv`,
    name: "video.mkv",
    folder,
    size: 1,
    direct: false,
  };
}

function media(format: string, date: readonly [number, number, number]): AniListMedia {
  const [year, month, day] = date;
  return {
    provider: "anilist",
    id: year,
    anilistId: year,
    idMal: null,
    title: { english: null, romaji: String(year), native: null },
    description: null,
    coverImage: { extraLarge: null, large: null, color: null },
    bannerImage: null,
    episodes: format === "MOVIE" ? 1 : 12,
    duration: 24,
    season: null,
    seasonYear: year,
    startDate: { year, month, day },
    format,
    status: null,
    genres: [],
    averageScore: null,
    siteUrl: "https://example.invalid",
    streamingEpisodes: [],
  };
}

test("sorts mapped library titles by newest air date and leaves undated titles last", () => {
  const groups = groupShows([entry("Undated"), entry("Older"), entry("Newer")]);
  const metadata: ShowMetadata = {
    [showMetadataKey("Older")]: media("TV", [2020, 4, 1]),
    [showMetadataKey("Newer")]: media("TV", [2024, 1, 1]),
  };

  expect(sortShowsByAirDate(groups, metadata).map((show) => show.name)).toEqual([
    "Newer",
    "Older",
    "Undated",
  ]);
});

test("recognizes movie formats from either metadata provider casing", () => {
  expect(isMovieMedia(media("MOVIE", [2024, 1, 1]))).toBe(true);
  expect(isMovieMedia(media("Movie", [2024, 1, 1]))).toBe(true);
  expect(isMovieMedia(media("TV", [2024, 1, 1]))).toBe(false);
});

test("keeps a franchise mapping while recognizing its child movie mapping", () => {
  const [show] = groupShows([entry("Legacy Movie")]);
  expect(show).toBeDefined();
  const parent = media("TV", [2020, 1, 1]);
  const movie = media("MOVIE", [2024, 1, 1]);
  const metadata = {
    [showMetadataKey("Legacy Movie")]: parent,
    [seasonMetadataKey("Legacy Movie", "Episodes")]: movie,
  };
  expect(primaryShowMetadata(show as NonNullable<typeof show>, metadata)).toBe(parent);
  expect(isMovieMedia(metadata[seasonMetadataKey("Legacy Movie", "Episodes")])).toBe(true);
});

test("groups movie folders with their series through shared parent metadata", () => {
  const parent = media("TV", [2020, 1, 1]);
  const metadata = {
    [showMetadataKey("Series")]: parent,
    [showMetadataKey("Movie")]: parent,
    [seasonMetadataKey("Movie", "Episodes")]: media("MOVIE", [2024, 1, 1]),
  };
  const groups = groupShows([entry("Series"), entry("Movie")], metadata);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.sourceNames).toEqual(["Series", "Movie"]);
  expect(groups[0]?.seasons).toHaveLength(2);
});
