import { describe, expect, test } from "bun:test";
import type { AniListMedia, MediaEntry } from "../types.ts";
import { episodeMetadata, episodeNumber } from "./anilist.ts";

function entry(name: string): MediaEntry {
  return {
    rel: `Show/001. Season 1/${name}`,
    name,
    folder: "Show/001. Season 1",
    size: 1024,
    direct: false,
  };
}

function mediaWithEpisodes(
  streamingEpisodes: AniListMedia["streamingEpisodes"],
): AniListMedia {
  return {
    id: 42,
    idMal: 42,
    anilistId: 42,
    provider: "anilist",
    title: { english: "Sample Show", romaji: "Sample Show", native: null },
    description: null,
    coverImage: { extraLarge: null, large: null, color: null },
    bannerImage: null,
    episodes: streamingEpisodes.length,
    duration: 24,
    season: "SPRING",
    seasonYear: 2024,
    startDate: { year: 2024, month: 4, day: 1 },
    format: "TV",
    status: "FINISHED",
    genres: ["Action"],
    averageScore: 80,
    siteUrl: "https://anilist.co/anime/42",
    streamingEpisodes,
  };
}

describe("episodeMetadata", () => {
  test("prefers organized filename title while preserving first matching thumbnail", () => {
    const media = mediaWithEpisodes([
      { title: "Episode 2 - First Title", thumbnail: "https://example.com/first.jpg", site: "a" },
      { title: "Episode 2 - Duplicate Title", thumbnail: "https://example.com/second.jpg", site: "b" },
    ]);

    expect(episodeMetadata(entry("002. Local Title.mkv"), media)).toEqual({
      title: "Local Title",
      thumbnail: "https://example.com/first.jpg",
    });
    expect(episodeMetadata(entry("Sample S01E02.mkv"), media)).toEqual({
      title: "First Title",
      thumbnail: "https://example.com/first.jpg",
    });
  });

  test("handles unnumbered episode formats and ignores non-episode files", () => {
    const media = mediaWithEpisodes([
      { title: "Episode 7 - Lucky Seven", thumbnail: "https://example.com/7.jpg", site: "a" },
    ]);

    expect(episodeNumber(entry("Sample - 07 [1080p].mkv"))).toBe(7);
    expect(episodeMetadata(entry("Sample - 07 [1080p].mkv"), media)).toEqual({
      title: "Lucky Seven",
      thumbnail: "https://example.com/7.jpg",
    });
    expect(episodeMetadata(entry("Opening Theme.mkv"), media)).toBeNull();
  });
});
