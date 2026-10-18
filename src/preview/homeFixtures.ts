import type { AniListMedia, MediaEntry, PlaybackProgressMap, ShowMetadata } from "../types.ts";
import type { ShowGroup } from "../lib/library.ts";
import { previewMetadata, previewShow } from "./fixtures.ts";

// Fictional library for the home preview, around the show-page fixture (or local snapshot).
const covers = import.meta.glob<string>("./assets/cover*.jpg", { eager: true, query: "?url", import: "default" });
const banners = import.meta.glob<string>("./assets/banner*.jpg", { eager: true, query: "?url", import: "default" });
const frames = Object.values(import.meta.glob<string>("./assets/ep*.jpg", { eager: true, query: "?url", import: "default" }));

interface FictionalShow {
  readonly title: string;
  readonly year: number;
  readonly episodes: number;
  readonly score: number;
  readonly genres: readonly string[];
  readonly format?: string;
}

const FICTIONAL: readonly FictionalShow[] = [
  { title: "Paper Kites over Harbor Nine", year: 2026, episodes: 12, score: 84, genres: ["Drama", "Slice of Life"] },
  { title: "The Quiet Engine", year: 2025, episodes: 24, score: 88, genres: ["Sci-Fi", "Mystery"] },
  { title: "Moth & Lantern", year: 2025, episodes: 13, score: 79, genres: ["Fantasy", "Romance"] },
  { title: "Saltwind Academy", year: 2024, episodes: 12, score: 72, genres: ["Comedy", "School"] },
  { title: "Glass Orbit", year: 2023, episodes: 26, score: 86, genres: ["Action", "Sci-Fi"] },
  { title: "A Thousand Red Doors", year: 2023, episodes: 1, score: 90, genres: ["Drama", "Supernatural"], format: "MOVIE" },
  { title: "Fernhollow Delivery Co.", year: 2022, episodes: 12, score: 81, genres: ["Adventure", "Comedy"] },
  { title: "Velvet Static", year: 2021, episodes: 11, score: 77, genres: ["Music", "Drama"] },
  { title: "Ninefold Crown", year: 2019, episodes: 25, score: 83, genres: ["Action", "Fantasy"] },
];

const EPISODE_NAMES = ["Departure", "The Long Way Round", "Small Hours", "Borrowed Light", "Undertow", "Signal Fires", "What the River Keeps", "Paper Moon"];
const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 9, 18);

interface FictionalFixture {
  readonly group: ShowGroup;
  readonly media: AniListMedia;
}

function fictionalShow(show: FictionalShow, index: number): FictionalFixture {
  const number = index + 1;
  const entries: MediaEntry[] = Array.from({ length: show.episodes }, (_, episode) => {
    const code = String(episode + 1).padStart(2, "0");
    return {
      rel: `${show.title}/${show.title} - S01E${code}.mkv`, name: `${show.title} - S01E${code}.mkv`, folder: show.title,
      size: 1, direct: true, addedAt: NOW - (index + 1) * 3 * DAY_MS,
    };
  });
  const media: AniListMedia = {
    provider: "anilist", id: 1000 + number, anilistId: null, idMal: null,
    title: { english: show.title, romaji: show.title, native: null },
    description: null,
    coverImage: { extraLarge: covers[`./assets/cover${String(number)}.jpg`] ?? null, large: null, color: null },
    bannerImage: banners[`./assets/banner${String(number)}.jpg`] ?? null,
    episodes: show.episodes, duration: 24, season: null, seasonYear: show.year, startDate: null,
    format: show.format ?? "TV", status: "FINISHED", genres: [...show.genres], averageScore: show.score,
    siteUrl: "https://anilist.co",
    streamingEpisodes: entries.map((_, episode) => ({
      title: `Episode ${String(episode + 1)} - ${EPISODE_NAMES[(index + episode) % EPISODE_NAMES.length] ?? ""}`, thumbnail: frames[(index * 3 + episode) % frames.length] ?? null, site: "preview",
    })),
  };
  return { group: { name: show.title, sourceNames: [show.title], seasons: [{ name: show.title, sourceShow: show.title, entries }], entries }, media };
}

const fictional = FICTIONAL.map((show, index) => fictionalShow(show, index));
// The featured show is the newest arrival.
const arrived = (entry: MediaEntry): MediaEntry => ({
  rel: entry.rel, name: entry.name, folder: entry.folder, size: entry.size, direct: entry.direct, addedAt: NOW,
});
const featuredSeasons = previewShow.seasons.map((season) => ({
  name: season.name, sourceShow: season.sourceShow, entries: season.entries.map((entry) => arrived(entry)),
}));
const featured: ShowGroup = { ...previewShow, entries: previewShow.entries.map((entry) => arrived(entry)), seasons: featuredSeasons };

export const homeShows: readonly ShowGroup[] = [featured, ...fictional.map((show) => show.group)];
export const homeEntries: readonly MediaEntry[] = homeShows.flatMap((show) => show.entries);
export const homeMetadata: ShowMetadata = {
  ...previewMetadata,
  ...Object.fromEntries(fictional.flatMap((show) => [
    [`show:${show.group.name}`, show.media],
    [`season:${show.group.name} / ${show.group.name}`, show.media],
  ])),
};

interface SavedAt {
  readonly rel: string | undefined;
  readonly position: number;
  readonly updatedAt: number;
  readonly completed?: boolean;
}

function progressAt({ rel, position, updatedAt, completed = false }: SavedAt): PlaybackProgressMap {
  return rel === undefined ? {} : { [rel]: { rel, position, duration: 1440, completed, updatedAt, dismissedAt: null } };
}

export type HomeState = "watching" | "fresh";

/** "watching": the featured show mid-episode plus three more in the queue; "fresh": nothing started yet. */
export function homeProgress(state: HomeState): PlaybackProgressMap {
  if (state === "fresh") {
    return {};
  }
  const show = (index: number) => fictional[index]?.group.entries;
  return {
    ...progressAt({ rel: featured.entries[4]?.rel, position: 760, updatedAt: 40 }),
    ...progressAt({ rel: show(1)?.[6]?.rel, position: 330, updatedAt: 30 }),
    ...progressAt({ rel: show(4)?.[1]?.rel, position: 1440, updatedAt: 20, completed: true }),
    ...progressAt({ rel: show(6)?.[2]?.rel, position: 1000, updatedAt: 10 }),
    // The movie is finished, so it shows as watched in the wall.
    ...progressAt({ rel: show(5)?.[0]?.rel, position: 1440, updatedAt: 5, completed: true }),
  };
}
