import { afterEach, expect, test } from "bun:test";
import type { AnimeMetadata } from "./metadataTypes.ts";
import { matchTvmaze } from "./tvmaze.ts";

const realFetch = globalThis.fetch;

interface FakeShow {
  readonly id: number;
  readonly name: string;
  readonly premiered: string;
  readonly seasons: readonly number[];
}

function episodes(show: FakeShow): unknown[] {
  return show.seasons.flatMap((season) => [1, 2].map((number) => ({
    id: show.id * 100 + season * 10 + number, season, number, type: "regular",
    name: `${show.name} S${String(season)}E${String(number)}`, summary: null, airdate: null, image: null,
  })));
}

/** TVmaze search returns every listed show for any query; episodes by show id. */
function fakeTvmaze(shows: readonly FakeShow[]): void {
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const id = /^\/shows\/(?<id>\d+)\/episodes$/u.exec(url.pathname)?.groups?.["id"];
    const show = shows.find((candidate) => String(candidate.id) === id);
    const body = show === undefined
      ? shows.map((candidate) => ({ show: { id: candidate.id, name: candidate.name, url: `https://tvmaze.invalid/${String(candidate.id)}`, premiered: candidate.premiered } }))
      : episodes(show);
    return Promise.resolve(Response.json(body));
  }) as typeof fetch;
}

function media(english: string, romaji: string, seasonYear: number): AnimeMetadata {
  return {
    provider: "anilist", id: 1, anilistId: 1, idMal: null,
    title: { english, romaji, native: null }, description: null,
    coverImage: { extraLarge: null, large: null, color: null }, bannerImage: null,
    episodes: 12, duration: 24, season: null, seasonYear, startDate: null, format: "TV", status: "FINISHED",
    genres: [], averageScore: null, siteUrl: "https://anilist.invalid/1", streamingEpisodes: [],
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("a later AniList season matches the TVmaze show that holds every season", async () => {
  fakeTvmaze([{ id: 7, name: "The Lantern Keepers", premiered: "2021-04-02", seasons: [1, 2, 3] }]);

  const match = await matchTvmaze(media("The Lantern Keepers Season 3", "Toudai no Mamorite 3rd Season", 2025));

  expect(match?.id).toBe(7);
  expect(match?.episodes.filter((episode) => episode.season === 3).map((episode) => episode.title))
    .toEqual(["The Lantern Keepers S3E1", "The Lantern Keepers S3E2"]);
});

test("a season title does not match a same-named show lacking that season", async () => {
  fakeTvmaze([{ id: 8, name: "The Lantern Keepers", premiered: "2021-04-02", seasons: [1] }]);

  expect(await matchTvmaze(media("The Lantern Keepers Season 3", "Toudai no Mamorite 3rd Season", 2025))).toBeNull();
});

test("a first season still needs its premiere year to match", async () => {
  fakeTvmaze([{ id: 9, name: "The Lantern Keepers", premiered: "1998-01-01", seasons: [1] }]);

  expect(await matchTvmaze(media("The Lantern Keepers", "Toudai no Mamorite", 2021))).toBeNull();
});
