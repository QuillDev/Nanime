import type { AniListMedia, PlaybackProgressMap, ShowMetadata } from "../types.ts";
import { formatDuration } from "../format.ts";
import { episodeNumber, mediaTitle } from "./anilist.ts";
import { isMovieMedia, primaryShowMetadata, type ShowGroup } from "./library.ts";
import type { ContinueWatchingItem } from "./continueWatching.ts";
import { isShowWatched, partitionShowsByWatched } from "./watchedShows.ts";
import { artSources, type ArtSources } from "./art.ts";
import { thumbnailUrl } from "../api.ts";

/** What the home banner can show: something being watched, or a show to start. */
export type HomeFeature =
  | { readonly kind: "continue"; readonly item: ContinueWatchingItem; readonly show: ShowGroup; readonly media: AniListMedia | undefined }
  | { readonly kind: "show"; readonly show: ShowGroup; readonly media: AniListMedia | undefined };

export type ShowSort = "added" | "title" | "year" | "score";

export const SHOW_SORTS: readonly { readonly key: ShowSort; readonly label: string }[] = [
  { key: "added", label: "Recently added" },
  { key: "title", label: "A–Z" },
  { key: "year", label: "Release year" },
  { key: "score", label: "Score" },
];

export type ShowFilter = "all" | "watching" | "unstarted" | "finished" | "movies";

export const SHOW_FILTERS: readonly { readonly key: ShowFilter; readonly label: string }[] = [
  { key: "all", label: "All shows" },
  { key: "watching", label: "Watching" },
  { key: "unstarted", label: "Not started" },
  { key: "finished", label: "Finished" },
  { key: "movies", label: "Movies" },
];

/** The newest file in a show marks when it was added (or last got a new episode). */
export function showAddedAt(show: ShowGroup): number {
  return show.entries.reduce((latest, entry) => Math.max(latest, entry.addedAt ?? 0), 0);
}

function displayTitle(show: ShowGroup, media: AniListMedia | undefined): string {
  return media === undefined ? show.name : mediaTitle(media);
}

function sortValue(show: ShowGroup, media: AniListMedia | undefined, sort: ShowSort): number {
  if (sort === "added") {
    return showAddedAt(show);
  }
  if (sort === "year") {
    return media?.seasonYear ?? media?.startDate?.year ?? 0;
  }
  return media?.averageScore ?? 0;
}

/** Newest, latest-released and best-scored first; ties and A–Z fall back to the display title. */
export function sortShows(shows: readonly ShowGroup[], metadata: ShowMetadata, sort: ShowSort): readonly ShowGroup[] {
  const keyed = shows.map((show) => {
    const media = primaryShowMetadata(show, metadata);
    return { show, title: displayTitle(show, media), value: sort === "title" ? 0 : sortValue(show, media, sort) };
  });
  return keyed
    .toSorted((a, b) => b.value - a.value || a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }))
    .map((item) => item.show);
}

interface ShowFilterContext {
  readonly metadata: ShowMetadata;
  readonly progress: PlaybackProgressMap;
}

function matchesFilter(show: ShowGroup, filter: ShowFilter, { metadata, progress }: ShowFilterContext): boolean {
  if (filter === "movies") {
    return isMovieMedia(primaryShowMetadata(show, metadata));
  }
  const finished = isShowWatched(show, progress);
  if (filter === "finished") {
    return finished;
  }
  const started = show.entries.some((entry) => progress[entry.rel] !== undefined);
  return filter === "watching" ? started && !finished : !started;
}

function lastWatchedAt(show: ShowGroup, progress: PlaybackProgressMap): number {
  return show.entries.reduce((latest, entry) => Math.max(latest, progress[entry.rel]?.updatedAt ?? 0), 0);
}

/** Most recently watched first: the order of the "Watching" filter. */
export function sortByLastWatched(shows: readonly ShowGroup[], progress: PlaybackProgressMap): readonly ShowGroup[] {
  return shows
    .map((show) => ({ show, at: lastWatchedAt(show, progress) }))
    .toSorted((a, b) => b.at - a.at)
    .map((item) => item.show);
}

/** The shows a home filter keeps: by how far along they are, or movies only. */
export function filterShows(shows: readonly ShowGroup[], filter: ShowFilter, context: ShowFilterContext): readonly ShowGroup[] {
  return filter === "all" ? shows : shows.filter((show) => matchesFilter(show, filter, context));
}

function showLength(media: AniListMedia): string | null {
  if (media.format === "MOVIE") {
    return "Movie";
  }
  return media.episodes === null ? null : `${String(media.episodes)} eps`;
}

/** "2026 · 12 eps", "2016 · Movie": the facts that tell shows apart in a wall of posters. */
export function showFacts(media: AniListMedia | undefined): string | null {
  if (media === undefined) {
    return null;
  }
  const year = media.seasonYear ?? media.startDate?.year ?? null;
  const parts = [year === null ? null : String(year), showLength(media)].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

const FEATURE_LIMIT = 8;

interface HomeFeatureContext extends ShowFilterContext {
  /** A number in [0, 1) choosing the show once every one has been watched. */
  readonly pick: number;
}

/**
 * The shows the home banner steps through: everything being watched, latest first. With nothing in progress,
 * the shows not started yet, newest first; once those run out, one show chosen by `pick`.
 */
export function homeFeatures(
  items: readonly ContinueWatchingItem[],
  shows: readonly ShowGroup[],
  { metadata, progress, pick }: HomeFeatureContext,
): readonly HomeFeature[] {
  const continuing = items.flatMap((item): HomeFeature[] => {
    const show = shows.find((candidate) => candidate.entries.some((entry) => entry.rel === item.entry.rel));
    return show === undefined ? [] : [{ kind: "continue", item, show, media: primaryShowMetadata(show, metadata) }];
  });
  if (continuing.length > 0) {
    return continuing;
  }
  const unstarted = sortShows(filterShows(shows, "unstarted", { metadata, progress }), metadata, "added").slice(0, FEATURE_LIMIT);
  const chosen = shows[Math.floor(pick * shows.length)];
  const starters = unstarted.length > 0 || chosen === undefined ? unstarted : [chosen];
  return starters.map((show) => ({ kind: "show", show, media: primaryShowMetadata(show, metadata) }));
}

export function watchedShowNames(shows: readonly ShowGroup[], progress: PlaybackProgressMap): ReadonlySet<string> {
  return new Set(partitionShowsByWatched(shows, progress).watched.map((show) => show.name));
}

export function percentWatched(item: ContinueWatchingItem): number {
  const { position, duration } = item.progress;
  return duration > 0 ? Math.min(100, position / duration * 100) : 0;
}

export function timeLeft(item: ContinueWatchingItem): string {
  if (item.kind === "next") {
    return "Up next";
  }
  return `${formatDuration(Math.max(item.progress.duration - item.progress.position, 0))} left`;
}

/** Without episode metadata the title is the file name; "Episode 7" reads better. */
export function episodeLabel(item: ContinueWatchingItem): string {
  if (item.episodeTitle !== item.entry.name) {
    return item.episodeTitle;
  }
  const number = episodeNumber(item.entry);
  return number === null ? item.episodeTitle : `Episode ${String(number)}`;
}

export interface HeroImage extends ArtSources {
  /** A stand-in (cover) rather than a banner or episode frame, shown blurred. */
  readonly blurred: boolean;
}

/** The home banner's backdrop: the show's banner, else the episode being watched, else its cover. */
export function heroBackdrop(feature: HomeFeature): HeroImage | null {
  const banner = feature.media?.bannerImage ?? null;
  const [first] = feature.show.entries;
  const frame = feature.kind === "continue" ? feature.item.thumbnail ?? thumbnailUrl(feature.item.entry.rel) : null;
  const fallback = frame ?? feature.media?.coverImage.extraLarge ?? (first === undefined ? null : thumbnailUrl(first.rel));
  const source = banner ?? fallback;
  if (source === null) {
    return null;
  }
  const blurred = banner === null && frame === null;
  return { ...artSources(source, blurred ? "cover" : "banner"), blurred };
}
