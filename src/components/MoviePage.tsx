import { useCallback } from "react";
import { ArrowLeft, Play } from "lucide-react";
import type {
  AniListMedia,
  MediaEntry,
  PlaybackProgressMap,
} from "../types.ts";
import { formatDuration } from "../format.ts";
import { hasMeaningfulPlaybackProgress, preloadPlayer } from "../lib/playback.ts";
import type { ShowGroup } from "../lib/library.ts";
import { AnimeDetails } from "./AnimeDetails.tsx";

interface MoviePageProps {
  readonly movie: ShowGroup;
  readonly media: AniListMedia;
  readonly progress: PlaybackProgressMap;
  readonly onBack: () => void;
  readonly onLink?: (() => void) | undefined;
  readonly onPlay: (entry: MediaEntry) => void;
}

interface MoviePlayButtonProps {
  readonly entry: MediaEntry;
  readonly multiple: boolean;
  readonly progress: PlaybackProgressMap;
  readonly onPlay: (entry: MediaEntry) => void;
}

function playLabel(completed: boolean, resumable: boolean): string {
  if (resumable) {
    return "Resume movie";
  }
  return completed ? "Watch again" : "Play movie";
}

function MoviePlayButton({
  entry,
  multiple,
  progress,
  onPlay,
}: MoviePlayButtonProps): React.JSX.Element {
  const handlePlay = useCallback(() => {
    onPlay(entry);
  }, [entry, onPlay]);
  const saved = progress[entry.rel];
  const resumable = saved !== undefined && !saved.completed &&
    hasMeaningfulPlaybackProgress(saved.position);
  const percent = saved === undefined || saved.duration <= 0
    ? 0
    : Math.min(100, Math.max(0, saved.position / saved.duration * 100));
  return (
    <button
      type="button"
      data-tv-primary
      onClick={handlePlay}
      onFocus={preloadPlayer}
      onPointerDown={preloadPlayer}
      onPointerEnter={preloadPlayer}
      className="w-full rounded-lg border border-primary bg-primary p-4 text-left text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-center gap-3">
        <Play className="size-5 fill-current" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">
            {playLabel(saved?.completed === true, resumable)}
          </span>
          {multiple && (
            <span className="mt-0.5 block truncate text-xs opacity-80">{entry.name}</span>
          )}
        </span>
        {resumable && (
          <span className="shrink-0 text-sm">{formatDuration(saved.position)} watched</span>
        )}
      </span>
      {resumable && (
        <progress
          aria-label="Movie progress"
          max={100}
          value={percent}
          className="playback-progress mt-3 block h-1 w-full"
        />
      )}
    </button>
  );
}

export function MoviePage({
  movie,
  media,
  progress,
  onBack,
  onLink,
  onPlay,
}: MoviePageProps): React.JSX.Element {
  const [preview] = movie.entries;
  return (
    <section>
      <button
        type="button"
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" />
        All titles
      </button>
      <div className="grid items-start gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {preview !== undefined && (
          <AnimeDetails
            fallbackTitle={movie.name}
            previewRel={preview.rel}
            media={media}
            onLink={onLink}
          />
        )}
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight">
            {movie.entries.length > 1 ? "Versions" : "Watch movie"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {movie.entries.length > 1
              ? "Choose a local version to play."
              : "Resume where you left off or start from the beginning."}
          </p>
          <ul className="mt-6 flex flex-col gap-3">
            {movie.entries.map((entry) => (
              <li key={entry.rel}>
                <MoviePlayButton
                  entry={entry}
                  multiple={movie.entries.length > 1}
                  progress={progress}
                  onPlay={onPlay}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
