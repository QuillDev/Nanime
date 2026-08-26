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
  seasonNumber,
  showMetadataKey,
  type ShowGroup,
} from "./library.ts";

export interface ContinueWatchingItem {
  readonly entry: MediaEntry;
  readonly progress: PlaybackProgress;
  readonly showTitle: string;
  readonly episodeTitle: string;
  readonly thumbnail: string | null | undefined;
}

function showTitle(metadata: ShowMetadata, localName: string): string {
  const media = metadata[showMetadataKey(localName)];
  return media === undefined ? localName : media.title.english ?? media.title.romaji;
}

export function buildContinueWatchingItems(
  shows: readonly ShowGroup[],
  metadata: ShowMetadata,
  progress: PlaybackProgressMap,
): readonly ContinueWatchingItem[] {
  return shows.flatMap((show) => show.seasons.flatMap((season) => {
    const media = seasonMetadata(metadata, season.sourceShow, season.name);
    const showMedia = primaryShowMetadata(show, metadata);
    const movie = isMovieMedia(media);
    return season.entries.flatMap((entry) => {
      const saved = progress[entry.rel];
      if (
        saved === undefined ||
        saved.completed ||
        saved.dismissedAt !== null && saved.dismissedAt >= saved.updatedAt ||
        !hasMeaningfulPlaybackProgress(saved.position)
      ) {
        return [];
      }
      const details = movie ? undefined : episodeMetadata(entry, media, {
        showMedia,
        season: seasonNumber(season, media),
      });
      return [{
        entry,
        progress: saved,
        showTitle: showTitle(metadata, show.name),
        episodeTitle: movie
          ? media.title.english ?? media.title.romaji
          : details?.title ?? entry.name,
        thumbnail: movie
          ? media.coverImage.large ?? media.coverImage.extraLarge
          : details?.thumbnail,
      }];
    });
  }).toSorted((a, b) => b.progress.updatedAt - a.progress.updatedAt).slice(0, 1))
    .toSorted((a, b) => b.progress.updatedAt - a.progress.updatedAt)
    .slice(0, 8);
}
