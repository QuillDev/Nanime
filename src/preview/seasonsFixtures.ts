import type { QueryClient } from "@tanstack/react-query";
import type { AniListMedia, MediaEntry, PlaybackProgressMap, ShowMetadata } from "../types.ts";
import { seasonMetadataKey, type SeasonGroup, type ShowGroup } from "../lib/library.ts";
import { previewMedia, previewMetadata, previewShow } from "./fixtures.ts";
import { seedPlayer } from "./playerFixtures.ts";

export { readyReadiness, renameStateShow } from "./renameFixtures.ts";

// The show-page fixture as a franchise: two seasons, a movie, and an unmatched release folder (the worst-case name).
const SOURCE = previewShow.sourceNames[0] ?? previewShow.name;
const TITLE = previewMedia.title.english ?? previewShow.name;
const MOVIE_NAME = "The Glass Ferry";
const MOVIE_TITLE = `${TITLE}: ${MOVIE_NAME}`;
const RELEASE = `[Judas] ${SOURCE} OVAs [BD 1080p][HEVC x265 10bit][Dual-Audio][Eng-Subs]`;

function season(name: string, files: readonly string[]): SeasonGroup {
  const folder = `${SOURCE}/${name}`;
  const entries: readonly MediaEntry[] = files.map((file) => ({ rel: `${folder}/${file}`, name: file, folder, size: 1, direct: false }));
  return { name, sourceShow: SOURCE, entries };
}

function episodeFiles(code: string): readonly string[] {
  return previewShow.entries.map((_, index) => `${SOURCE} - ${code}E${String(index + 1).padStart(2, "0")}.mkv`);
}

const first = season("Season 1", episodeFiles("S01"));
const second = season("Season 2", episodeFiles("S02"));
const movie = season("Movie", [`${MOVIE_TITLE}.mkv`]);
const release = season(RELEASE, [1, 2, 3].map((number) => `[Judas] ${SOURCE} OVA - ${String(number).padStart(2, "0")}.mkv`));
const seasons = [first, second, movie, release];

const seasonsShow: ShowGroup = { ...previewShow, seasons, entries: seasons.flatMap((group) => group.entries) };

const covers = Object.values(import.meta.glob<string>("./assets/cover*.jpg", { eager: true, query: "?url", import: "default" }));

function matched(group: SeasonGroup, media: Partial<AniListMedia>): readonly [string, AniListMedia] {
  const cover = covers[seasons.indexOf(group)] ?? null;
  return [seasonMetadataKey(SOURCE, group.name), { ...previewMedia, coverImage: { extraLarge: cover, large: null, color: null }, ...media }];
}

const year = previewMedia.seasonYear ?? 2026;

/** The show page's metadata: the single-season fixture plus the franchise's season matches. */
export const showPageMetadata: ShowMetadata = {
  ...previewMetadata,
  ...Object.fromEntries([
    matched(first, { id: 2001 }),
    matched(second, { id: 2002, seasonYear: year + 1, title: { english: `${TITLE}: Low Tide`, romaji: `${TITLE}: Low Tide`, native: null } }),
    matched(movie, { id: 2003, format: "MOVIE", episodes: 1, duration: 104, seasonYear: year + 2, title: { english: MOVIE_TITLE, romaji: MOVIE_TITLE, native: null } }),
  ]),
};

function saved(entry: MediaEntry, index: number, position: number): PlaybackProgressMap {
  return { [entry.rel]: { rel: entry.rel, position, duration: 1440, completed: position === 1440, updatedAt: index + 1, dismissedAt: null } };
}

// Season 1 finished, season 2 half way with one episode in progress.
const WATCHED_IN_SECOND = 6;
const seasonsProgress: PlaybackProgressMap = Object.assign(
  {},
  ...first.entries.map((entry, index) => saved(entry, index, 1440)),
  ...second.entries.slice(0, WATCHED_IN_SECOND + 1).map((entry, index) => saved(entry, 100 + index, index === WATCHED_IN_SECOND ? 640 : 1440)),
) as PlaybackProgressMap;

/** The franchise for the "seasons…" and "player…" states. "seasons" opens on the season being watched; "seasons-movie" and "seasons-release" pick another from the rail; "seasons-about" opens the phone's About section. */
export function seasonsState(state: string): { readonly show: ShowGroup; readonly progress: PlaybackProgressMap } | null {
  return state.startsWith("seasons") || state.startsWith("player") ? { show: seasonsShow, progress: seasonsProgress } : null;
}

export function seedSeasons(client: QueryClient, state: string): void {
  seedPlayer(client, state, seasonsShow.entries.map((entry) => entry.rel));
  for (const group of seasons) {
    const paths = group.entries.map((entry) => entry.rel);
    client.setQueryData(["playback-readiness", ...paths], { workers: 2, items: paths.map((path) => ({ path, ready: true, transcode: null })) });
  }
  const picked = { "seasons-movie": MOVIE_NAME, "seasons-release": RELEASE }[state];
  if (state === "seasons-about") {
    setTimeout(() => {
      document.querySelector<HTMLElement>("main > div > details > summary")?.click();
    }, 400);
  }
  if (picked !== undefined) {
    setTimeout(() => {
      [...document.querySelectorAll<HTMLButtonElement>("fieldset button")].find((button) => button.textContent.includes(picked))?.click();
    }, 400);
  }
}
