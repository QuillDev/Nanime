import { expect, test } from "bun:test";
import { join } from "node:path";
import { configureMetadataLibrary, metadataResponse } from "./anilist.ts";
import {
  enrichMediaEpisodes,
  EpisodeProviderError,
  type EpisodeMetadataProvider,
} from "./episodeMetadata.ts";
import { cachedEpisodeMetadata } from "./episodeMetadataCache.ts";
import { writeFolderMatches } from "./folderMetadata.ts";
import { storeCachedMetadata } from "./metadataCache.ts";
import type { AnimeMetadata } from "./metadataTypes.ts";
import { withFakeUpstream } from "./testFetch.ts";
import { withTemporaryDirectory } from "./testProcess.ts";

function uniqueId(): number {
  return 700_000_000 + Math.floor(Math.random() * 100_000_000);
}

function sampleMedia(
  id: number,
  overrides: Partial<AnimeMetadata> = {},
): AnimeMetadata {
  return {
    provider: "anilist",
    id,
    anilistId: id,
    idMal: 50_000 + (id % 10_000),
    title: { english: "Sample Show", romaji: "Sample Show", native: null },
    description: null,
    coverImage: { extraLarge: null, large: null, color: null },
    bannerImage: null,
    episodes: 3,
    duration: 24,
    season: "FALL",
    seasonYear: 2025,
    startDate: null,
    format: "TV",
    status: "FINISHED",
    genres: [],
    averageScore: null,
    siteUrl: `https://anilist.co/anime/${String(id)}`,
    streamingEpisodes: [],
    ...overrides,
  };
}

test("fetches ani.zip episodes, normalizes titles and thumbnails, caches in SQLite, and refreshes on bypass", async () => {
  const id = uniqueId();
  let requests = 0;
  let includeEpisodeFour = false;

  await withFakeUpstream((url) => {
    requests += 1;
    expect(url.href).toBe(`https://api.ani.zip/mappings?anilist_id=${String(id)}`);
    const baseEpisodes = {
      "1": {
        title: { en: "Let`s Start Breaking Common Ground" },
        image: "https://artworks.thetvdb.com/banners/v4/episode/1/screencap/ep1.jpg",
      },
      "2": {
        title: { en: "Episode 2 - Second Step" },
        image: "https://untrusted.example/ep2.jpg",
      },
      "3": {
        title: { en: "Episode 3" },
        image: "https://artworks.thetvdb.com/banners/v4/episode/3/screencap/ep3.jpg",
      },
      S1: {
        title: { en: "Special Preview" },
        image: "https://artworks.thetvdb.com/banners/v4/episode/99/screencap/s1.jpg",
      },
    };
    const episodes = includeEpisodeFour
      ? {
        ...baseEpisodes,
        "4": {
          title: { en: "Freshly Aired" },
          image: "https://artworks.thetvdb.com/banners/v4/episode/4/screencap/ep4.jpg",
        },
      }
      : baseEpisodes;
    return Response.json({ episodes });
  }, async () => {
    const base = sampleMedia(id, { episodes: 4 });
    const [first, concurrent] = await Promise.all([
      enrichMediaEpisodes(base),
      enrichMediaEpisodes(base),
    ]);
    expect(requests).toBe(1);
    expect(first.streamingEpisodes).toEqual([
      {
        title: "Episode 1 - Let's Start Breaking Common Ground",
        thumbnail: "https://artworks.thetvdb.com/banners/v4/episode/1/screencap/ep1.jpg",
        site: "ani.zip",
      },
      {
        title: "Episode 2 - Second Step",
        thumbnail: null,
        site: "ani.zip",
      },
      {
        title: "Episode 3",
        thumbnail: "https://artworks.thetvdb.com/banners/v4/episode/3/screencap/ep3.jpg",
        site: "ani.zip",
      },
    ]);
    expect(concurrent.streamingEpisodes).toEqual(first.streamingEpisodes);

    // Subsequent loads read SQLite cache with zero network requests.
    const fromCache = await enrichMediaEpisodes(base);
    expect(requests).toBe(1);
    expect(fromCache.streamingEpisodes).toEqual(first.streamingEpisodes);
    expect(cachedEpisodeMetadata(id)?.providers).toEqual(["ani.zip"]);

    // Explicit refresh bypasses cache and updates SQLite with newly aired episodes.
    includeEpisodeFour = true;
    const refreshed = await enrichMediaEpisodes(base, { bypassCache: true });
    expect(requests).toBe(2);
    expect(refreshed.streamingEpisodes).toHaveLength(4);
    expect(refreshed.streamingEpisodes[3]?.title).toBe("Episode 4 - Freshly Aired");
  });
});

test("caches 404 misses from ani.zip so unmapped shows are not re-fetched on every load", async () => {
  const id = uniqueId();
  let requests = 0;
  await withFakeUpstream(() => {
    requests += 1;
    return new Response("Not found", { status: 404 });
  }, async () => {
    const base = sampleMedia(id, { episodes: 12 });
    const first = await enrichMediaEpisodes(base);
    const second = await enrichMediaEpisodes(base);
    expect(first).toBe(base);
    expect(second).toBe(base);
    expect(requests).toBe(1);
    expect(cachedEpisodeMetadata(id)?.episodes).toEqual([]);
  });
});

test("skips fallback providers when AniList already provides complete episodes", async () => {
  const id = uniqueId();
  let calls = 0;
  const provider: EpisodeMetadataProvider = {
    name: "unused-provider",
    fetchEpisodes: () => {
      calls += 1;
      return Promise.resolve([]);
    },
  };
  const complete = sampleMedia(id, {
    episodes: 2,
    streamingEpisodes: [
      { title: "Episode 1 - Opening", thumbnail: "https://img1.ak.crunchyroll.com/1.jpg", site: "Crunchyroll" },
      { title: "Episode 2 - Next", thumbnail: "https://img1.ak.crunchyroll.com/2.jpg", site: "Crunchyroll" },
    ],
  });

  const result = await enrichMediaEpisodes(complete, { providers: [provider] });
  expect(result).toBe(complete);
  expect(calls).toBe(0);
});

test("merges across multiple fallback providers in priority order and opens circuit on outage", async () => {
  const firstId = uniqueId();
  const secondId = uniqueId();
  const brokenName = `broken-${String(firstId)}`;
  let brokenCalls = 0;
  let partialCalls = 0;
  let secondaryCalls = 0;
  let trailingCalls = 0;

  const brokenProvider: EpisodeMetadataProvider = {
    name: brokenName,
    fetchEpisodes: () => {
      brokenCalls += 1;
      return Promise.reject(new EpisodeProviderError("Service unavailable", 503));
    },
  };
  const partialProvider: EpisodeMetadataProvider = {
    name: "partial",
    fetchEpisodes: () => {
      partialCalls += 1;
      return Promise.resolve([
        { number: 1, title: "From Partial", thumbnail: null, source: "partial" },
      ]);
    },
  };
  const secondaryProvider: EpisodeMetadataProvider = {
    name: "secondary",
    fetchEpisodes: () => {
      secondaryCalls += 1;
      return Promise.resolve([
        {
          number: 1,
          title: "Should Not Override",
          thumbnail: "https://artworks.thetvdb.com/banners/v4/episode/10/screencap/1.jpg",
          source: "secondary",
        },
        {
          number: 2,
          title: "From Secondary",
          thumbnail: "https://image.tmdb.org/t/p/w500/ep2.jpg",
          source: "secondary",
        },
      ]);
    },
  };
  const trailingProvider: EpisodeMetadataProvider = {
    name: "trailing",
    fetchEpisodes: () => {
      trailingCalls += 1;
      return Promise.resolve([]);
    },
  };

  const providers = [brokenProvider, partialProvider, secondaryProvider, trailingProvider];
  const enriched = await enrichMediaEpisodes(sampleMedia(firstId, { episodes: 2 }), { providers });
  expect(enriched.streamingEpisodes).toEqual([
    {
      title: "Episode 1 - From Partial",
      thumbnail: "https://artworks.thetvdb.com/banners/v4/episode/10/screencap/1.jpg",
      site: "partial",
    },
    {
      title: "Episode 2 - From Secondary",
      thumbnail: "https://image.tmdb.org/t/p/w500/ep2.jpg",
      site: "secondary",
    },
  ]);
  expect(brokenCalls).toBe(1);
  expect(partialCalls).toBe(1);
  expect(secondaryCalls).toBe(1);
  // Stopped early once episodes 1..2 had both titles and thumbnails.
  expect(trailingCalls).toBe(0);

  // Circuit breaker skips brokenProvider for the next show instead of hammering it.
  await enrichMediaEpisodes(sampleMedia(secondId, { episodes: 2 }), { providers });
  expect(brokenCalls).toBe(1);
  expect(partialCalls).toBe(2);
  expect(secondaryCalls).toBe(2);
});

test("keeps previously cached episodes if all fallback providers fail during refresh", async () => {
  const id = uniqueId();
  const working: EpisodeMetadataProvider = {
    name: `working-${String(id)}`,
    fetchEpisodes: () => Promise.resolve([
      {
        number: 1,
        title: "Cached Episode",
        thumbnail: "https://artworks.thetvdb.com/banners/v4/episode/7/screencap/1.jpg",
        source: "working",
      },
    ]),
  };
  const failing: EpisodeMetadataProvider = {
    name: `failing-${String(id)}`,
    fetchEpisodes: () => Promise.reject(new EpisodeProviderError("Outage", 503)),
  };

  const base = sampleMedia(id, { episodes: 1 });
  const initial = await enrichMediaEpisodes(base, { providers: [working] });
  expect(initial.streamingEpisodes).toHaveLength(1);

  const afterOutage = await enrichMediaEpisodes(base, { providers: [failing], bypassCache: true });
  expect(afterOutage.streamingEpisodes).toEqual(initial.streamingEpisodes);
});

test("backfills existing cached library shows once on metadata load", async () => {
  const id = uniqueId();
  await withTemporaryDirectory("nanime-ep-meta-", async (root) => {
    await Bun.write(join(root, "Chiramune", "[Group] Chiramune - S01E01 [1080p].mkv"), "video");
    writeFolderMatches(root, [
      { folder: "Chiramune", role: "show", match: { provider: "anilist", id } },
    ]);
    storeCachedMetadata(`show|anilist:${String(id)}`, sampleMedia(id, { episodes: 1 }));
    configureMetadataLibrary({
      root,
      videoFolders: () => Promise.resolve(["Chiramune"]),
    });

    let upstreamCalls = 0;
    await withFakeUpstream(() => {
      upstreamCalls += 1;
      return Response.json({
        episodes: {
          "1": {
            title: { en: "The Hazy Spring Moon Above" },
            image: "https://artworks.thetvdb.com/banners/v4/episode/11/screencap/1.jpg",
          },
        },
      });
    }, async () => {
      const first = await metadataResponse();
      const firstBody = await first.json() as Readonly<Record<string, AnimeMetadata>>;
      expect(firstBody["show:Chiramune"]?.streamingEpisodes).toEqual([
        {
          title: "Episode 1 - The Hazy Spring Moon Above",
          thumbnail: "https://artworks.thetvdb.com/banners/v4/episode/11/screencap/1.jpg",
          site: "ani.zip",
        },
      ]);
      expect(upstreamCalls).toBe(1);

      // Second library metadata load uses cache with zero external calls.
      const second = await metadataResponse();
      const secondBody = await second.json() as Readonly<Record<string, AnimeMetadata>>;
      expect(secondBody["show:Chiramune"]?.streamingEpisodes).toEqual(firstBody["show:Chiramune"]?.streamingEpisodes);
      expect(upstreamCalls).toBe(1);
    });
  });
});
