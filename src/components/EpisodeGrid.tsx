import { useCallback } from "react";
import type {
  AniListMedia,
  MediaEntry,
  PlaybackProgressMap,
} from "../types.ts";
import { episodeMetadata, episodeNumber } from "../lib/anilist.ts";
import { hasMeaningfulPlaybackProgress, preloadPlayer } from "../lib/playback.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";

interface EpisodeCardProps {
  readonly entry: MediaEntry;
  readonly media: AniListMedia | undefined;
  readonly progress: PlaybackProgressMap;
  readonly onSelect: (entry: MediaEntry) => void;
  readonly showMedia: AniListMedia | undefined;
  readonly seasonNumber: number;
}

function EpisodeCard({
  entry,
  media,
  progress,
  onSelect,
  showMedia,
  seasonNumber,
}: EpisodeCardProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelect(entry);
  }, [entry, onSelect]);
  const details = episodeMetadata(entry, media, { showMedia, season: seasonNumber });
  const number = episodeNumber(entry);
  const episodeProgress = progress[entry.rel];
  const showProgress = episodeProgress !== undefined && (
    episodeProgress.completed || hasMeaningfulPlaybackProgress(episodeProgress.position)
  );
  const progressPercent = episodeProgress === undefined || episodeProgress.duration <= 0
    ? 0
    : Math.min(100, Math.max(0, episodeProgress.position / episodeProgress.duration * 100));

  return (
    <li className="flex overflow-hidden rounded-lg border border-border bg-card transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-primary">
      <button
        type="button"
        onClick={handleClick}
        onFocus={preloadPlayer}
        onPointerDown={preloadPlayer}
        onPointerEnter={preloadPlayer}
        className="group flex min-w-0 flex-1 text-left focus-visible:outline-none"
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
              {details?.title ?? entry.name}
            </span>
          </span>
        </span>
      </button>
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
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <EpisodeCard
          key={entry.rel}
          entry={entry}
          media={media}
          progress={progress}
          onSelect={onSelect}
          showMedia={showMedia}
          seasonNumber={seasonNumber}
        />
      ))}
    </ul>
  );
}
