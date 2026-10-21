import { useCallback, useMemo } from "react";
import type { AniListMedia, MediaEntry, PlaybackProgressMap } from "../types.ts";
import { episodeMetadata, episodeNumber, mediaTitle } from "../lib/anilist.ts";
import { isMovieMedia } from "../lib/library.ts";
import { hasMeaningfulPlaybackProgress, preloadPlayer } from "../lib/playback.ts";
import { episodePlaybackTarget } from "../lib/seasonWatched.ts";
import { formatRemaining, type EpisodeTranscodeState } from "../lib/seasonTranscode.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";
import { EpisodeActionsMenu, type EpisodeWatchedHandler } from "./EpisodeActionsMenu.tsx";
import { cn } from "../lib/utils.ts";

export interface EpisodeTileProps {
  readonly entry: MediaEntry;
  readonly media: AniListMedia | undefined;
  readonly progress: PlaybackProgressMap;
  readonly onSelect: (entry: MediaEntry) => void;
  readonly onSetWatched: EpisodeWatchedHandler;
  readonly pending: boolean;
  readonly transcode: EpisodeTranscodeState;
  /** Admins can set the episode's title (its file name). */
  readonly canRename: boolean;
}

interface WatchView {
  readonly percent: number;
  readonly show: boolean;
  readonly watched: boolean;
}

function watchView(entry: MediaEntry, progress: PlaybackProgressMap): WatchView {
  const item = progress[entry.rel];
  if (item === undefined) {
    return { percent: 0, show: false, watched: false };
  }
  const percent = item.duration <= 0 ? 0 : Math.min(100, Math.max(0, item.position / item.duration * 100));
  return { percent, show: item.completed || hasMeaningfulPlaybackProgress(item.position), watched: item.completed };
}

function TranscodeOverlay({ state }: { readonly state: EpisodeTranscodeState }): React.JSX.Element | null {
  if (state.kind === "needs-transcode" || state.kind === "failed") {
    const failed = state.kind === "failed";
    return (
      <span className="absolute inset-0 grid place-items-center">
        <span className={cn(
          "rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold ring-1",
          failed ? "text-destructive ring-destructive/60" : "text-warning ring-warning/50",
        )}
        >
          {failed ? "Transcode failed" : "Needs transcode"}
        </span>
      </span>
    );
  }
  if (state.kind === "transcoding") {
    const percent = Math.floor(state.progress * 100);
    return (
      <>
        <span className="absolute inset-0 grid place-items-center text-center [text-shadow:0_2px_18px_rgb(0_0_0/0.6)]">
          <span>
            <span className="block font-display text-4xl font-extrabold tracking-tight tabular-nums">{percent}%</span>
            {state.remainingSeconds !== null && (
              <span className="block text-xs font-medium opacity-85">{formatRemaining(state.remainingSeconds)} left</span>
            )}
          </span>
        </span>
        <progress aria-label="Transcode progress" max={100} value={percent} className="playback-progress absolute inset-x-0 bottom-0 block h-1 w-full" />
      </>
    );
  }
  return state.kind === "queued" && state.next
    ? <span className="absolute left-2.5 top-2.5 rounded-md bg-black/65 px-2 py-0.5 text-xs font-medium">Up next</span>
    : null;
}

function captionDetail(state: EpisodeTranscodeState, media: AniListMedia | undefined): string | null {
  if (state.kind === "transcoding") {
    return "Transcoding";
  }
  if (state.kind === "queued") {
    return "Queued";
  }
  return media?.duration === null || media?.duration === undefined ? null : `${String(media.duration)} min`;
}

function renameTarget(
  canRename: boolean,
  number: number | null,
  details: { readonly title: string } | null,
): { readonly number: number; readonly title: string } | undefined {
  return canRename && number !== null ? { number, title: details?.title ?? "" } : undefined;
}

/** Loading counts as playable-looking, so tiles never flash a warning they may not need. */
function blocksPlayback(state: EpisodeTranscodeState): boolean {
  return state.kind !== "ready" && state.kind !== "loading";
}

export function EpisodeTile({
  entry, media, progress, onSelect, onSetWatched, pending, transcode, canRename,
}: EpisodeTileProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelect(entry);
  }, [entry, onSelect]);
  const movie = isMovieMedia(media);
  const details = movie ? null : episodeMetadata(entry, media);
  const number = movie ? null : episodeNumber(entry);
  const title = movie ? mediaTitle(media) : details?.title ?? entry.name;
  const watch = watchView(entry, progress);
  const unavailable = blocksPlayback(transcode);
  const detail = captionDetail(transcode, media);
  const rename = useMemo(() => renameTarget(canRename, number, details), [canRename, details, number]);
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={handleClick}
        onFocus={preloadPlayer}
        onPointerDown={preloadPlayer}
        onPointerEnter={preloadPlayer}
        className="group block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={cn(
          "relative block overflow-hidden rounded-xl transition-transform group-hover:scale-[1.015] group-focus-visible:scale-[1.015] [&_img]:transition-[filter] [&_img]:duration-300",
          unavailable && "[&_img]:brightness-[.4] [&_img]:grayscale",
          transcode.kind === "transcoding" && "[&_img]:brightness-50 [&_img]:grayscale-[.6]",
        )}
        >
          <MediaThumbnail rel={entry.rel} source={details?.thumbnail} watched={watch.watched && !unavailable} sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw" className="w-full" />
          <TranscodeOverlay state={transcode} />
          {watch.show && !unavailable && (
            <progress aria-label="Episode progress" max={100} value={watch.watched ? 100 : watch.percent} className="playback-progress absolute inset-x-0 bottom-0 block h-1 w-full" />
          )}
        </span>
      </button>
      <div className="mt-1.5 flex min-w-0 items-center gap-2">
        <span className="flex min-w-0 flex-1 items-baseline gap-2 text-sm font-medium">
          {number !== null && <span className="shrink-0 text-muted-foreground/70 tabular-nums">{String(number).padStart(2, "0")}</span>}
          <span className="truncate" title={entry.name}>{title}</span>
        </span>
        {detail !== null && <span className="shrink-0 text-xs text-muted-foreground">{detail}</span>}
        <EpisodeActionsMenu
          entry={entry}
          pending={pending}
          watched={watch.watched}
          onSetWatched={onSetWatched}
          target={episodePlaybackTarget(entry, media)}
          rename={rename}
        />
      </div>
    </li>
  );
}
