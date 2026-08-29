import type {
  AniListMedia,
  AniListPlaybackTarget,
  MediaEntry,
  PlaybackProgressMap,
} from "../types.ts";
import type { PlaybackWatchedUpdate } from "../playbackApi.ts";
import { episodeNumber, mediaTitle } from "./anilist.ts";
import { isMovieMedia } from "./library.ts";

export function episodePlaybackTarget(
  entry: MediaEntry,
  media: AniListMedia | undefined,
): AniListPlaybackTarget | null {
  if (media?.anilistId === null || media?.anilistId === undefined) {
    return null;
  }
  const totalEpisodes = media.episodes;
  const movie = isMovieMedia(media);
  const episode = movie ? 1 : episodeNumber(entry);
  if (episode === null) {
    return null;
  }
  return {
    mediaId: media.anilistId,
    episode,
    totalEpisodes: movie ? 1 : totalEpisodes,
    title: mediaTitle(media),
  };
}

export function isSeasonWatched(
  entries: readonly MediaEntry[],
  progress: PlaybackProgressMap,
): boolean {
  return entries.length > 0 && entries.every((entry) => (
    progress[entry.rel]?.completed === true
  ));
}

function watchedUpdate(
  entry: MediaEntry,
  media: AniListMedia | undefined,
  watched: boolean,
): PlaybackWatchedUpdate {
  const target = episodePlaybackTarget(entry, media);
  return target === null
    ? { rel: entry.rel, watched }
    : {
      rel: entry.rel,
      watched,
      anilistMediaId: target.mediaId,
      episode: target.episode,
      totalEpisodes: target.totalEpisodes,
    };
}

export function seasonWatchedUpdates(
  entries: readonly MediaEntry[],
  media: AniListMedia | undefined,
  watched: boolean,
): readonly PlaybackWatchedUpdate[] {
  const orderedEntries = watched ? entries : entries.toReversed();
  return orderedEntries.map((entry) => watchedUpdate(entry, media, watched));
}
