import type { AnimeMetadata } from "./metadataTypes.ts";

export function manualAniListMetadata(id: number, title: string, current: AnimeMetadata | undefined): AnimeMetadata {
  const base: AnimeMetadata = current?.provider === "anilist" && current.id === id ? current : {
    provider: "anilist", id, anilistId: id, idMal: null,
    title: { english: null, romaji: title, native: null },
    description: null, coverImage: { extraLarge: null, large: null, color: null },
    bannerImage: null, episodes: null, duration: null, season: null, seasonYear: null,
    startDate: null, format: null, status: null, genres: [], averageScore: null,
    siteUrl: `https://anilist.co/anime/${String(id)}`, streamingEpisodes: [],
  };
  return { ...base, title: { ...base.title, english: title, romaji: title } };
}
