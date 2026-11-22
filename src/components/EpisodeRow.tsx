import { useCallback, useMemo } from "react";
import type { AniListMedia, MediaEntry, PlaybackProgressMap } from "../types.ts";
import { episodeMetadata, episodeNumber, mediaTitle } from "../lib/anilist.ts";
import { isMovieMedia } from "../lib/library.ts";
import { preloadPlayer } from "../lib/playback.ts";
import { episodePlaybackTarget } from "../lib/seasonWatched.ts";
import type { EpisodeTranscodeState } from "../lib/seasonTranscode.ts";
import { EpisodeRowNote, EpisodeRowStatus, EpisodeRowThumbnail } from "./EpisodeRowParts.tsx";
import { watchView } from "../lib/episodeWatch.ts";
import { EpisodeActionsMenu, type EpisodeWatchedHandler } from "./EpisodeActionsMenu.tsx";

export interface EpisodeRowProps {
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

function renameTarget(
  canRename: boolean,
  number: number | null,
  details: { readonly title: string } | null,
): { readonly number: number; readonly title: string } | undefined {
  return canRename && number !== null ? { number, title: details?.title ?? "" } : undefined;
}

export function EpisodeRow({
  entry, media, progress, onSelect, onSetWatched, pending, transcode, canRename,
}: EpisodeRowProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelect(entry);
  }, [entry, onSelect]);
  const movie = isMovieMedia(media);
  const details = movie ? null : episodeMetadata(entry, media);
  const number = movie ? null : episodeNumber(entry);
  const title = movie ? mediaTitle(media) : details?.title ?? entry.name;
  const watch = watchView(entry, progress);
  const rename = useMemo(() => renameTarget(canRename, number, details), [canRename, details, number]);
  return (
    <li className="flex min-w-0 items-center gap-3 border-t border-white/[0.07] py-2 first:border-t-0 sm:gap-4">
      <button
        type="button"
        onClick={handleClick}
        onFocus={preloadPlayer}
        onPointerDown={preloadPlayer}
        onPointerEnter={preloadPlayer}
        className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-4"
      >
        <EpisodeRowThumbnail entry={entry} source={details?.thumbnail} state={transcode} watch={watch} />
        {number !== null && <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground/70">{number}</span>}
        <span className="min-w-0 flex-1">
          <span className={`line-clamp-2 text-[15px] font-medium group-hover:text-primary group-focus-visible:text-primary sm:line-clamp-1 ${watch.watched ? "text-muted-foreground" : ""}`} title={entry.name}>{title}</span>
          <EpisodeRowNote state={transcode} className="block sm:hidden" />
        </span>
      </button>
      <EpisodeRowStatus state={transcode} watch={watch} minutes={media?.duration} />
      <EpisodeActionsMenu
        entry={entry}
        pending={pending}
        watched={watch.watched}
        onSetWatched={onSetWatched}
        target={episodePlaybackTarget(entry, media)}
        rename={rename}
      />
    </li>
  );
}
