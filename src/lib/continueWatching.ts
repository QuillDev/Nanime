import type {
  MediaEntry,
  PlaybackProgress,
  PlaybackProgressMap,
  ShowMetadata,
} from "../types.ts";
import { episodeMetadata } from "./anilist.ts";
import { hasMeaningfulPlaybackProgress } from "./playback.ts";
import {
  isMovieMedia,
  primaryShowMetadata,
  seasonMetadata,
  showMetadataKey,
  type ShowGroup,
} from "./library.ts";

export interface ContinueWatchingItem {
  readonly dismissRel: string;
  readonly entry: MediaEntry;
  readonly kind: "next" | "resume";
  readonly progress: PlaybackProgress;
  readonly showTitle: string;
  readonly episodeTitle: string;
  readonly thumbnail: string | null | undefined;
}

interface ShowEpisode {
  readonly entry: MediaEntry;
  readonly media: ReturnType<typeof seasonMetadata>;
  readonly movie: boolean;
  readonly season: ShowGroup["seasons"][number];
  readonly showMedia: ReturnType<typeof primaryShowMetadata>;
}

interface ContinueItemOptions {
  readonly dismissRel?: string;
  readonly episode: ShowEpisode;
  readonly kind: ContinueWatchingItem["kind"];
  readonly metadata: ShowMetadata;
  readonly saved: PlaybackProgress;
  readonly show: ShowGroup;
}

interface PlaybackAnchor {
  readonly episode: ShowEpisode;
  readonly index: number;
  readonly saved: PlaybackProgress;
}

interface CompletedContinuationOptions {
  readonly episodes: readonly ShowEpisode[];
  readonly latest: PlaybackAnchor;
  readonly metadata: ShowMetadata;
  readonly progress: PlaybackProgressMap;
  readonly show: ShowGroup;
}

function showTitle(metadata: ShowMetadata, localName: string): string {
  const media = metadata[showMetadataKey(localName)];
  return media === undefined ? localName : media.title.english ?? media.title.romaji;
}

function orderedEpisodes(show: ShowGroup, metadata: ShowMetadata): readonly ShowEpisode[] {
  const showMedia = primaryShowMetadata(show, metadata);
  return show.seasons.flatMap((season) => {
    const media = seasonMetadata(metadata, season.sourceShow, season.name);
    const movie = isMovieMedia(media);
    return season.entries.map((entry) => ({ entry, media, movie, season, showMedia }));
  });
}

function continueItem(options: ContinueItemOptions): ContinueWatchingItem {
  const { show, episode, metadata, saved, kind } = options;
  const dismissRel = options.dismissRel ?? episode.entry.rel;
  const { entry, media, movie } = episode;
  const details = movie ? undefined : episodeMetadata(entry, media);
  return {
    dismissRel,
    entry,
    kind,
    progress: saved,
    showTitle: showTitle(metadata, show.name),
    episodeTitle: movie && media !== undefined
      ? media.title.english ?? media.title.romaji
      : details?.title ?? entry.name,
    thumbnail: movie && media !== undefined
      ? media.coverImage.large ?? media.coverImage.extraLarge
      : details?.thumbnail,
  };
}

function latestPlayback(
  episodes: readonly ShowEpisode[],
  progress: PlaybackProgressMap,
): PlaybackAnchor | undefined {
  const [latest] = episodes.flatMap((episode, index) => {
    const saved = progress[episode.entry.rel];
    return saved === undefined ? [] : [{ episode, index, saved }];
  }).toSorted((a, b) => b.saved.updatedAt - a.saved.updatedAt);
  return latest;
}

function nextEpisode(
  episodes: readonly ShowEpisode[],
  currentIndex: number,
  progress: PlaybackProgressMap,
): ShowEpisode | undefined {
  return episodes.slice(currentIndex + 1).find((episode) => (
    progress[episode.entry.rel]?.completed !== true
  ));
}

function nextProgress(
  episode: ShowEpisode,
  completed: PlaybackProgress,
  progress: PlaybackProgressMap,
): PlaybackProgress {
  const existing = progress[episode.entry.rel];
  if (existing !== undefined && !existing.completed &&
    hasMeaningfulPlaybackProgress(existing.position)) {
    return existing;
  }
  return {
    rel: episode.entry.rel,
    position: 0,
    duration: existing?.duration ?? 0,
    completed: false,
    updatedAt: completed.updatedAt,
    dismissedAt: null,
  };
}

function completedContinuation(
  options: CompletedContinuationOptions,
): ContinueWatchingItem | null {
  const { show, metadata, progress, episodes, latest } = options;
  const next = nextEpisode(episodes, latest.index, progress);
  if (next === undefined) {
    return null;
  }
  const saved = nextProgress(next, latest.saved, progress);
  const resume = hasMeaningfulPlaybackProgress(saved.position);
  return continueItem({
    show,
    episode: next,
    metadata,
    saved,
    kind: resume ? "resume" : "next",
    dismissRel: resume ? next.entry.rel : latest.episode.entry.rel,
  });
}

function showContinuation(
  show: ShowGroup,
  metadata: ShowMetadata,
  progress: PlaybackProgressMap,
): ContinueWatchingItem | null {
  const episodes = orderedEpisodes(show, metadata);
  const latest = latestPlayback(episodes, progress);
  if (latest === undefined || latest.saved.dismissedAt !== null &&
    latest.saved.dismissedAt >= latest.saved.updatedAt) {
    return null;
  }
  if (!latest.saved.completed) {
    return hasMeaningfulPlaybackProgress(latest.saved.position)
      ? continueItem({
        show,
        episode: latest.episode,
        metadata,
        saved: latest.saved,
        kind: "resume",
      })
      : null;
  }
  return completedContinuation({ show, metadata, progress, episodes, latest });
}

export function buildContinueWatchingItems(
  shows: readonly ShowGroup[],
  metadata: ShowMetadata,
  progress: PlaybackProgressMap,
): readonly ContinueWatchingItem[] {
  return shows.flatMap((show) => {
    const item = showContinuation(show, metadata, progress);
    return item === null ? [] : [item];
  })
    .toSorted((a, b) => b.progress.updatedAt - a.progress.updatedAt)
    .slice(0, 8);
}
