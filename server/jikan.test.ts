import { expect, test } from "bun:test";
import { fetchJikanMedia, searchJikan } from "./jikan.ts";
import { withFakeUpstream } from "./testFetch.ts";

const ANIME = {
  mal_id: 12_345,
  url: "https://myanimelist.net/anime/12345/Example",
  title: "Example Anime",
  title_english: "Example Anime English",
  title_japanese: "サンプル",
  synopsis: "A <b>sample</b> synopsis.",
  images: {
    webp: {
      image_url: "https://cdn.example.invalid/cover.webp",
      large_image_url: "https://cdn.example.invalid/cover-large.webp",
    },
  },
  trailer: { images: { maximum_image_url: null } },
  episodes: 12,
  duration: "24 min per ep",
  season: "fall",
  year: 2025,
  aired: { from: "2025-10-04T00:00:00+00:00" },
  type: "TV",
  status: "Finished Airing",
  genres: [{ name: "Comedy" }],
  score: 8.2,
};

test("normalizes Jikan search, details, and episode metadata, retrying a gateway timeout", async () => {
  let searchAttempts = 0;
  await withFakeUpstream((url) => {
    if (url.pathname.endsWith("/episodes")) {
      return Response.json({ data: [{ mal_id: 1, title: "The Beginning", url: null }], pagination: { has_next_page: false } });
    }
    if (url.pathname.endsWith("/full")) {
      return Response.json({ data: ANIME });
    }
    searchAttempts += 1;
    return searchAttempts === 1 ? new Response(null, { status: 504 }) : Response.json({ data: [ANIME] });
  }, async () => {
    const [result] = await searchJikan("Example Anime");
    expect(result?.provider).toBe("jikan");
    expect(result?.anilistId).toBeNull();
    expect(result?.duration).toBe(24);
    expect(result?.averageScore).toBe(82);
    expect(result?.startDate).toEqual({ year: 2025, month: 10, day: 4 });
    expect(result?.description).toBe("A sample synopsis.");

    const linked = await fetchJikanMedia(12_345);
    expect(linked.streamingEpisodes).toEqual([{
      title: "Episode 1 - The Beginning",
      thumbnail: null,
      site: "MyAnimeList",
    }]);
  });
});
