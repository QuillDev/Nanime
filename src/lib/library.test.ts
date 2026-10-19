import { expect, test } from "bun:test";
import type { AniListMedia, MediaEntry } from "../types.ts";
import {
  groupShows,
  isMovieMedia,
  partitionShowsByMetadata,
  primaryShowMetadata,
  seasonMetadataKey,
  showMetadataKey,
  sortShowsByMetadataTitle,
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

test("sorts library shows alphabetically with natural numeric ordering", () => {
  const groups = groupShows([entry("Show 10"), entry("Beta"), entry("Show 2"), entry("Alpha")]);
  expect(groups.map((show) => show.name)).toEqual(["Alpha", "Beta", "Show 2", "Show 10"]);
});

test("partitions mapped and unmapped local shows without changing their order", () => {
  const groups = groupShows([entry("Mapped"), entry("Unmapped")]);
  const metadata = { [showMetadataKey("Mapped")]: media("TV", [2024, 1, 1]) };
  const partitioned = partitionShowsByMetadata(groups, metadata);
  expect(partitioned.mapped.map((show) => show.name)).toEqual(["Mapped"]);
  expect(partitioned.unmapped.map((show) => show.name)).toEqual(["Unmapped"]);
});

test("sorts mapped shows by their displayed provider titles", () => {
  const groups = groupShows([entry("Alpha Folder"), entry("Zulu Folder")]);
  const metadata = {
    [showMetadataKey("Alpha Folder")]: {
      ...media("TV", [2024, 1, 1]),
      title: { english: "Zebra", romaji: "Zebra", native: null },
    },
    [showMetadataKey("Zulu Folder")]: {
      ...media("TV", [2025, 1, 1]),
      title: { english: "Apple", romaji: "Apple", native: null },
    },
  };
  expect(sortShowsByMetadataTitle(groups, metadata).map((show) => show.name)).toEqual([
    "Zulu Folder",
    "Alpha Folder",
  ]);
});

test("recognizes movie formats from either metadata provider casing", () => {
  expect(isMovieMedia(media("MOVIE", [2024, 1, 1]))).toBe(true);
  expect(isMovieMedia(media("Movie", [2024, 1, 1]))).toBe(true);
  expect(isMovieMedia(media("TV", [2024, 1, 1]))).toBe(false);
});

test("keeps the franchise mapping primary when a season is mapped to a movie", () => {
  const [show] = groupShows([entry("Legacy Movie")]);
  expect(show).toBeDefined();
  const parent = media("TV", [2020, 1, 1]);
  const movie = media("MOVIE", [2024, 1, 1]);
  const metadata = {
    [showMetadataKey("Legacy Movie")]: parent,
    [seasonMetadataKey("Legacy Movie", "Episodes")]: movie,
  };
  expect(primaryShowMetadata(show as NonNullable<typeof show>, metadata)).toBe(parent);
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
