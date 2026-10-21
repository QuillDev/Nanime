import type { AniListMedia, PlaybackProgressMap, ShowMetadata } from "../types.ts";
import { formatDuration } from "../format.ts";
import { episodeNumber, mediaTitle } from "./anilist.ts";
import { primaryShowMetadata, type ShowGroup } from "./library.ts";
import type { ContinueWatchingItem } from "./continueWatching.ts";
import { partitionShowsByWatched } from "./watchedShows.ts";
import { artSources, type ArtSources } from "./art.ts";
import { thumbnailUrl } from "../api.ts";

/** What the home banner features: the latest thing being watched, else the newest show. */
export type HomeFeature =
  | { readonly kind: "continue"; readonly item: ContinueWatchingItem; readonly show: ShowGroup; readonly media: AniListMedia | undefined }
  | { readonly kind: "new"; readonly show: ShowGroup; readonly media: AniListMedia | undefined };

export type ShowSort = "added" | "title" | "year" | "score";

export const SHOW_SORTS: readonly { readonly key: ShowSort; readonly label: string }[] = [
  { key: "added", label: "Recently added" },
  { key: "title", label: "A–Z" },
  { key: "year", label: "Release year" },
  { key: "score", label: "Score" },
];

/** Shows below this size gain nothing from a separate "Recently added" row: the wall shows them all. */
export const RECENT_ROW_MIN_SHOWS = 8;
export const RECENT_ROW_SIZE = 4;

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

export function recentlyAddedShows(shows: readonly ShowGroup[], metadata: ShowMetadata): readonly ShowGroup[] {
  if (shows.length < RECENT_ROW_MIN_SHOWS) {
    return [];
  }
  return sortShows(shows, metadata, "added").slice(0, RECENT_ROW_SIZE);
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

/** The latest thing being watched; with nothing in progress, the newest show. */
export function homeFeature(
  items: readonly ContinueWatchingItem[],
  shows: readonly ShowGroup[],
  metadata: ShowMetadata,
): HomeFeature | null {
  for (const item of items) {
    const show = shows.find((candidate) => candidate.entries.some((entry) => entry.rel === item.entry.rel));
    if (show !== undefined) {
      return { kind: "continue", item, show, media: primaryShowMetadata(show, metadata) };
    }
  }
  const [newest] = sortShows(shows, metadata, "added");
  return newest === undefined ? null : { kind: "new", show: newest, media: primaryShowMetadata(newest, metadata) };
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
