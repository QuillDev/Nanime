import {
  CheckCheck,
  EllipsisVertical,
  ExternalLink,
  EyeOff,
  Link,
  PenLine,
} from "lucide-react";
import { useCallback, useRef } from "react";
import type { AniListMedia, PlaybackProgressMap } from "../types.ts";
import type { SeasonGroup } from "../lib/library.ts";
import { isSeasonWatched, seasonWatchedUpdates } from "../lib/seasonWatched.ts";
import { useSetSeasonWatched } from "../hooks/usePlaybackProgress.ts";
import { useSeriesCompletionPrompt } from "./SeriesCompletionPrompt.tsx";
import { useSeasonRename } from "../hooks/useRenameDialogs.ts";
import { RenameEpisodesDialog } from "./RenameEpisodesDialog.tsx";

interface SeasonActionsMenuProps {
  readonly media: AniListMedia | undefined;
  readonly playbackMedia: AniListMedia | undefined;
  readonly progress: PlaybackProgressMap;
  readonly season: SeasonGroup;
  readonly title: string;
  readonly onLink?: ((season: SeasonGroup) => void) | undefined;
  /** Admins can organize the season's names. */
  readonly canRename: boolean;
  readonly showMedia: AniListMedia | undefined;
  readonly seasonNumber: number;
}

const MENU_ITEM = "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none";

export function SeasonActionsMenu({
  media,
  playbackMedia,
  progress,
  season,
  title,
  onLink,
  canRename,
  showMedia,
  seasonNumber,
}: SeasonActionsMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const watchedState = useSetSeasonWatched();
  const promptForScore = useSeriesCompletionPrompt();
  const watched = isSeasonWatched(season.entries, progress);
  const closeMenu = useCallback(() => {
    menuRef.current?.removeAttribute("open");
  }, []);
  const handleWatched = useCallback(() => {
    const nextWatched = !watched;
    const updates = seasonWatchedUpdates(season.entries, playbackMedia, nextWatched);
    watchedState.mutate(updates, {
      onSuccess: () => {
        const lastUpdate = updates.at(-1);
        if (nextWatched && lastUpdate?.anilistMediaId !== undefined &&
          lastUpdate.episode !== undefined && lastUpdate.totalEpisodes !== undefined) {
          promptForScore({
            mediaId: lastUpdate.anilistMediaId,
            episode: lastUpdate.episode,
            totalEpisodes: lastUpdate.totalEpisodes,
            title,
          });
        }
        closeMenu();
      },
    });
  }, [closeMenu, playbackMedia, promptForScore, season.entries, title, watched, watchedState]);
  const handleLink = useCallback(() => {
    onLink?.(season);
    closeMenu();
  }, [closeMenu, onLink, season]);
  const rename = useSeasonRename({ enabled: canRename, season, media: playbackMedia, showMedia, seasonNumber }, closeMenu);

  return (
    <details ref={menuRef} className="relative shrink-0 open:z-30">
      <summary
        aria-label={`More actions for ${title}`}
        className="flex size-9 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      >
        <EllipsisVertical className="size-5" />
      </summary>
      <div role="menu" className="absolute right-0 top-10 z-20 min-w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
        <button
          type="button"
          role="menuitem"
          disabled={watchedState.isPending}
          onClick={handleWatched}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"
        >
          {watched ? <EyeOff className="size-4" /> : <CheckCheck className="size-4" />}
          {watched ? "Mark season as unwatched" : "Mark season as watched"}
        </button>
        {onLink !== undefined && (
          <button
            type="button"
            role="menuitem"
            onClick={handleLink}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <Link className="size-4" />
            {media === undefined ? "Match metadata" : "Change metadata match"}
          </button>
        )}
        {rename.plan !== null && (
          <button type="button" role="menuitem" onClick={rename.handleOpen} className={MENU_ITEM}>
            <PenLine className="size-4" />
            Rename episodes
          </button>
        )}
        {media !== undefined && (
          <a
            href={media.siteUrl}
            target="_blank"
            rel="noreferrer"
            role="menuitem"
            onClick={closeMenu}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <ExternalLink className="size-4" />
            View on AniList
          </a>
        )}
        {watchedState.error !== null && (
          <output className="block px-2 py-1 text-xs text-destructive">
            Could not update season: {watchedState.error.message}
          </output>
        )}
      </div>
      {rename.open && rename.plan !== null && <RenameEpisodesDialog plan={rename.plan} onClose={rename.handleClose} />}
    </details>
  );
}
