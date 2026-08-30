import { useCallback } from "react";
import type {
  AniListMedia,
  AniListPlaybackTarget,
  MediaEntry,
  PlaybackProgressMap,
} from "../types.ts";
import { episodeMetadata, episodeNumber, mediaTitle } from "../lib/anilist.ts";
import { isMovieMedia } from "../lib/library.ts";
import { hasMeaningfulPlaybackProgress, preloadPlayer } from "../lib/playback.ts";
import { episodePlaybackTarget } from "../lib/seasonWatched.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";
import { useSetPlaybackWatched } from "../hooks/usePlaybackProgress.ts";
import { useSeriesCompletionPrompt } from "./SeriesCompletionPrompt.tsx";
import {
  EpisodeActionsMenu,
  type EpisodeWatchedHandler,
} from "./EpisodeActionsMenu.tsx";

interface EpisodeCardProps {
  readonly entry: MediaEntry;
  readonly media: AniListMedia | undefined;
  readonly progress: PlaybackProgressMap;
  readonly onSelect: (entry: MediaEntry) => void;
  readonly onSetWatched: EpisodeWatchedHandler;
  readonly pending: boolean;
  readonly showMedia: AniListMedia | undefined;
  readonly seasonNumber: number;
}

interface EpisodeProgressView {
  readonly percent: number;
  readonly show: boolean;
  readonly watched: boolean;
}

function episodeProgressView(
  entry: MediaEntry,
  progress: PlaybackProgressMap,
): EpisodeProgressView {
  const item = progress[entry.rel];
  if (item === undefined) {
    return { percent: 0, show: false, watched: false };
  }
  const percent = item.duration <= 0
    ? 0
    : Math.min(100, Math.max(0, item.position / item.duration * 100));
  return {
    percent,
    show: item.completed || hasMeaningfulPlaybackProgress(item.position),
    watched: item.completed,
  };
}

function EpisodeCard({
  entry,
  media,
  progress,
  onSelect,
  onSetWatched,
  pending,
  showMedia,
  seasonNumber,
}: EpisodeCardProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelect(entry);
  }, [entry, onSelect]);
  const movie = isMovieMedia(media);
  const details = movie
    ? null
    : episodeMetadata(entry, media, { showMedia, season: seasonNumber });
  const number = movie ? null : episodeNumber(entry);
  const target = episodePlaybackTarget(entry, media);
  const title = movie ? mediaTitle(media) : details?.title ?? entry.name;
  const progressView = episodeProgressView(entry, progress);

  return (
    <li className="flex rounded-lg border border-border bg-card transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-primary">
      <button
        type="button"
        onClick={handleClick}
        onFocus={preloadPlayer}
        onPointerDown={preloadPlayer}
        onPointerEnter={preloadPlayer}
        className="group flex min-w-0 flex-1 overflow-hidden rounded-l-lg text-left focus-visible:outline-none"
      >
        <span className="w-32 shrink-0 sm:w-44">
          <span className="relative block">
            <MediaThumbnail
              rel={entry.rel}
              source={details?.thumbnail}
              className="w-full"
            />
            {progressView.watched && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs font-semibold uppercase tracking-wider text-white">
                Watched
              </span>
            )}
          </span>
          {progressView.show && (
            <progress
              aria-label="Episode progress"
              max={100}
              value={progressView.watched ? 100 : progressView.percent}
              className="playback-progress block h-1 w-full overflow-hidden"
            />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col justify-center p-4">
          <span className="flex min-w-0 items-baseline gap-3">
            {number !== null && (
              <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
                {String(number).padStart(2, "0")}
              </span>
            )}
            <span className="line-clamp-2 font-medium" title={entry.name}>
              {title}
            </span>
          </span>
        </span>
      </button>
      <EpisodeActionsMenu
        entry={entry}
        pending={pending}
        watched={progressView.watched}
        onSetWatched={onSetWatched}
        target={target}
      />
    </li>
  );
}

interface EpisodeGridProps {
  readonly entries: readonly MediaEntry[];
  readonly media: AniListMedia | undefined;
  readonly progress: PlaybackProgressMap;
  readonly onSelect: (entry: MediaEntry) => void;
  readonly showMedia: AniListMedia | undefined;
  readonly seasonNumber: number;
}

export function EpisodeGrid({
  entries,
  media,
  progress,
  onSelect,
  showMedia,
  seasonNumber,
}: EpisodeGridProps): React.JSX.Element {
  const watchedState = useSetPlaybackWatched();
  const promptForScore = useSeriesCompletionPrompt();
  const handleSetWatched = useCallback((
    rel: string,
    watched: boolean,
    target: AniListPlaybackTarget | null,
  ) => {
    const update = target === null
      ? { rel, watched }
      : {
        rel,
        watched,
        anilistMediaId: target.mediaId,
        episode: target.episode,
        totalEpisodes: target.totalEpisodes,
      };
    watchedState.mutate(update, {
      onSuccess: () => {
        if (watched && target !== null) {
          promptForScore(target);
        }
      },
    });
  }, [promptForScore, watchedState]);
  return (
    <div>
      {watchedState.error !== null && (
        <p className="mb-3 text-sm text-destructive">
          Could not update episode: {watchedState.error.message}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <EpisodeCard
            key={entry.rel}
            entry={entry}
            media={media}
            progress={progress}
            onSelect={onSelect}
            onSetWatched={handleSetWatched}
            pending={watchedState.isPending && watchedState.variables?.rel === entry.rel}
            showMedia={showMedia}
            seasonNumber={seasonNumber}
          />
        ))}
      </ul>
    </div>
  );
}
