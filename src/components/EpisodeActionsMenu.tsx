import {
  Check,
  Download,
  EllipsisVertical,
  EyeOff,
  RotateCw,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useRef } from "react";
import type { AniListPlaybackTarget, MediaEntry } from "../types.ts";
import { useOfflineDownloads } from "../hooks/useOfflineDownloads.ts";
import type { OfflineDownload } from "../offline/index.ts";
import { RenameEpisodeAction } from "./RenameEpisodeDialog.tsx";

export type EpisodeWatchedHandler = (
  rel: string,
  watched: boolean,
  target: AniListPlaybackTarget | null,
) => void;

interface EpisodeActionsMenuProps {
  readonly entry: MediaEntry;
  readonly pending: boolean;
  readonly watched: boolean;
  readonly onSetWatched: EpisodeWatchedHandler;
  readonly target: AniListPlaybackTarget | null;
  /** Admins only: the episode's number and shown title, to rename it. */
  readonly rename?: { readonly number: number; readonly title: string } | undefined;
}

interface OfflineAction {
  readonly icon: LucideIcon;
  readonly label: string;
}

function offlineAction(active: boolean, saved: OfflineDownload | undefined): OfflineAction {
  if (active) {
    return { icon: X, label: "Cancel download" };
  }
  if (saved?.state === "complete") {
    return { icon: Trash2, label: "Remove download" };
  }
  return saved === undefined
    ? { icon: Download, label: "Download episode" }
    : { icon: RotateCw, label: "Retry download" };
}

function activeOfflineDownload(saved: OfflineDownload | undefined): boolean {
  return saved?.state === "preparing" || saved?.state === "downloading";
}

export function EpisodeActionsMenu({
  entry,
  pending,
  watched,
  onSetWatched,
  target,
  rename,
}: EpisodeActionsMenuProps): React.JSX.Element {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const offline = useOfflineDownloads();
  const saved = offline.downloads.data?.find((item) => item.rel === entry.rel);
  const active = activeOfflineDownload(saved);
  const action = offlineAction(active, saved);
  const handleWatched = useCallback(() => {
    onSetWatched(entry.rel, !watched, target);
    detailsRef.current?.removeAttribute("open");
  }, [entry.rel, onSetWatched, target, watched]);
  const handleOffline = useCallback(() => {
    if (active) {
      offline.cancel(entry.rel);
    } else if (saved?.state === "complete") {
      offline.remove.mutate(saved);
    } else {
      offline.start(entry);
    }
    detailsRef.current?.removeAttribute("open");
  }, [active, entry, offline, saved]);
  const OfflineIcon = action.icon;
  return (
    <details ref={detailsRef} className="relative shrink-0 p-2 open:z-30">
      <summary aria-label="Episode actions" className="flex size-9 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <EllipsisVertical className="size-5" />
      </summary>
      <div role="menu" className="absolute right-2 top-11 z-20 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
        <button type="button" role="menuitem" disabled={pending} onClick={handleWatched} className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50">
          {watched ? <EyeOff className="size-4" /> : <Check className="size-4" />}
          {watched ? "Mark as unwatched" : "Mark as watched"}
        </button>
        <button type="button" role="menuitem" disabled={offline.remove.isPending} onClick={handleOffline} className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50">
          <OfflineIcon className="size-4" />
          {action.label}
        </button>
        {rename !== undefined && <RenameEpisodeAction entry={entry} number={rename.number} title={rename.title} menuRef={detailsRef} />}
        {offline.download.error !== null && (
          <p className="max-w-64 px-2 py-1 text-xs text-destructive" role="alert">
            {offline.download.error.message}
          </p>
        )}
      </div>
    </details>
  );
}
