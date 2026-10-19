import type { AniListMedia, MediaEntry, PlaybackProgress, PlaybackProgressMap, ShowMetadata } from "../types.ts";
import { episodeMetadata, episodeNumber, mediaTitle } from "./anilist.ts";
import { hasMeaningfulPlaybackProgress } from "./playback.ts";
import {
  groupShows,
  isMovieMedia,
  primaryShowMetadata,
  seasonMetadata,
  seasonNumber,
  type SeasonGroup,
  type ShowGroup,
} from "./library.ts";

/** How the profile page names one library file: show, episode number and artwork. */
export interface ProfileEpisode {
  readonly rel: string;
  readonly showName: string;
  readonly showTitle: string;
  readonly number: number | null;
  readonly thumbnail: string | null;
  readonly banner: string | null;
}

export interface RecentEpisode {
  readonly episode: ProfileEpisode;
  readonly progress: PlaybackProgress;
}

export type ProfileEpisodes = ReadonlyMap<string, ProfileEpisode>;

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/u, "");
}

interface SeasonContext {
  readonly show: ShowGroup;
  readonly showTitle: string;
  readonly showMedia: AniListMedia | undefined;
  readonly metadata: ShowMetadata;
}

function seasonEpisodes(season: SeasonGroup, context: SeasonContext): readonly ProfileEpisode[] {
  const { show, showTitle, showMedia, metadata } = context;
  const media = seasonMetadata(metadata, season.sourceShow, season.name) ?? showMedia;
  const movie = isMovieMedia(media);
  const number = seasonNumber(season, media);
  const banner = media?.bannerImage ?? showMedia?.bannerImage ?? null;
  return season.entries.map((entry: MediaEntry) => {
    const details = movie ? null : episodeMetadata(entry, media, { showMedia, season: number });
    return {
      rel: entry.rel,
      showName: show.name,
      showTitle,
      number: movie ? null : episodeNumber(entry),
      thumbnail: movie ? media.coverImage.large ?? media.coverImage.extraLarge : details?.thumbnail ?? null,
      banner,
    };
  });
}

/** Indexes every library file by path with its display names, mapped or not. */
export function buildProfileEpisodes(entries: readonly MediaEntry[], metadata: ShowMetadata): ProfileEpisodes {
  const episodes = new Map<string, ProfileEpisode>();
  for (const show of groupShows(entries, metadata)) {
    const showMedia = primaryShowMetadata(show, metadata);
    const showTitle = showMedia === undefined ? show.name : mediaTitle(showMedia);
    for (const season of show.seasons) {
      for (const episode of seasonEpisodes(season, { show, showTitle, showMedia, metadata })) {
        episodes.set(episode.rel, episode);
      }
    }
  }
  return episodes;
}

/** Looks up a file, falling back to names derived from its path once it left the library. */
export function profileEpisode(episodes: ProfileEpisodes, rel: string): ProfileEpisode {
  const known = episodes.get(rel);
  if (known !== undefined) {
    return known;
  }
  const parts = rel.split("/");
  const name = parts.at(-1) ?? rel;
  const showName = parts.length > 1 ? parts[0] ?? name : stripExtension(name);
  return {
    rel,
    showName,
    showTitle: showName,
    number: episodeNumber({ rel, name, folder: parts.slice(0, -1).join("/"), size: 0, direct: false }),
    thumbnail: null,
    banner: null,
  };
}

export function episodeShortLabel(episode: ProfileEpisode): string {
  return episode.number === null ? "" : `E${String(episode.number)}`;
}

function isWatched(saved: PlaybackProgress): boolean {
  return saved.completed || hasMeaningfulPlaybackProgress(saved.position);
}

/** Newest watched episodes still in the library, one per show. */
export function recentlyWatched(
  episodes: ProfileEpisodes,
  progress: PlaybackProgressMap,
  limit: number,
): readonly RecentEpisode[] {
  const seen = new Set<string>();
  return Object.values(progress)
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
    .flatMap((saved) => {
      const episode = episodes.get(saved.rel);
      return episode !== undefined && isWatched(saved) ? [{ episode, progress: saved }] : [];
    })
    .filter(({ episode }) => {
      const first = !seen.has(episode.showName);
      seen.add(episode.showName);
      return first;
    })
    .slice(0, limit);
}

export interface DayGroup<T> {
  readonly label: string;
  readonly items: readonly T[];
}

function dayStart(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayLabel(start: number, today: number): string {
  if (start === today) {
    return "Today";
  }
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (start === yesterday.getTime()) {
    return "Yesterday";
  }
  const date = new Date(start);
  const sameYear = date.getFullYear() === new Date(today).getFullYear();
  return date.toLocaleDateString(undefined, sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
}

/** Groups newest-first items under Today, Yesterday, then dates, keeping their order. */
export function groupByDay<T extends { readonly createdAt: number }>(
  items: readonly T[],
  now = Date.now(),
): readonly DayGroup<T>[] {
  const today = dayStart(now);
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = dayLabel(dayStart(item.createdAt), today);
    const last = groups.at(-1);
    if (last?.label === label) {
      last.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}
