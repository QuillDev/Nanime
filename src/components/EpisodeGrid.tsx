import { Check, EllipsisVertical, EyeOff } from "lucide-react";
import { useCallback, useRef } from "react";
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

interface EpisodeStatusMenuProps {
  readonly pending: boolean;
  readonly rel: string;
  readonly watched: boolean;
  readonly onSetWatched: EpisodeWatchedHandler;
  readonly target: AniListPlaybackTarget | null;
}

type EpisodeWatchedHandler = (
  rel: string,
  watched: boolean,
  target: AniListPlaybackTarget | null,
) => void;

function EpisodeStatusMenu({
  pending,
  rel,
  watched,
  onSetWatched,
  target,
}: EpisodeStatusMenuProps): React.JSX.Element {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const handleSelection = useCallback(() => {
    onSetWatched(rel, !watched, target);
    detailsRef.current?.removeAttribute("open");
  }, [onSetWatched, rel, target, watched]);
  return (
    <details ref={detailsRef} className="relative shrink-0 p-2 open:z-30">
      <summary
        aria-label="Episode actions"
        className="flex size-9 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      >
        <EllipsisVertical className="size-5" />
      </summary>
      <div role="menu" className="absolute right-2 top-11 z-20 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
        <button
          type="button"
          role="menuitem"
          disabled={pending}
          onClick={handleSelection}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"
        >
          {watched ? <EyeOff className="size-4" /> : <Check className="size-4" />}
          {watched ? "Mark as unwatched" : "Mark as watched"}
        </button>
      </div>
    </details>
  );
}

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
  const episodeProgress = progress[entry.rel];
  const showProgress = episodeProgress !== undefined && (
    episodeProgress.completed || hasMeaningfulPlaybackProgress(episodeProgress.position)
  );
  const progressPercent = episodeProgress === undefined || episodeProgress.duration <= 0
    ? 0
    : Math.min(100, Math.max(0, episodeProgress.position / episodeProgress.duration * 100));

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
            {episodeProgress?.completed === true && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs font-semibold uppercase tracking-wider text-white">
                Watched
              </span>
            )}
          </span>
          {showProgress && (
            <progress
              aria-label="Episode progress"
              max={100}
              value={episodeProgress.completed ? 100 : progressPercent}
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
      <EpisodeStatusMenu
        pending={pending}
        rel={entry.rel}
        watched={episodeProgress?.completed === true}
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
