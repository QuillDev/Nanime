import { useCallback, useMemo } from "react";
import { Play, X } from "lucide-react";
import type {
  MediaEntry,
  PlaybackProgressMap,
  ShowMetadata,
} from "../types.ts";
import { formatDuration } from "../format.ts";
import { preloadPlayer } from "../lib/playback.ts";
import {
  buildContinueWatchingItems,
  type ContinueWatchingItem,
} from "../lib/continueWatching.ts";
import { useDismissPlaybackProgress } from "../hooks/usePlaybackProgress.ts";
import type { ShowGroup } from "../lib/library.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/ContextMenu.tsx";

export type { ContinueWatchingItem } from "../lib/continueWatching.ts";

interface ContinueCardProps {
  readonly item: ContinueWatchingItem;
  readonly onSelect: (entry: MediaEntry) => void;
  readonly onDismiss: (rel: string) => void;
}

function ContinueCard({ item, onSelect, onDismiss }: ContinueCardProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelect(item.entry);
  }, [item, onSelect]);
  const handleDismiss = useCallback(() => {
    onDismiss(item.entry.rel);
  }, [item.entry.rel, onDismiss]);
  const percent = item.progress.duration > 0
    ? Math.min(100, item.progress.position / item.progress.duration * 100)
    : 0;
  const remaining = Math.max(item.progress.duration - item.progress.position, 0);

  return (
    <li className="group relative">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>
            <button
              type="button"
              onClick={handleClick}
              onFocus={preloadPlayer}
              onPointerDown={preloadPlayer}
              onPointerEnter={preloadPlayer}
              className="w-full overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="relative block">
                <MediaThumbnail
                  rel={item.entry.rel}
                  source={item.thumbnail}
                  className="w-full"
                />
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex size-10 items-center justify-center rounded-full bg-black text-primary">
                    <Play className="ml-0.5 size-5 fill-current" />
                  </span>
                </span>
                <progress
                  aria-label="Playback progress"
                  max={100}
                  value={percent}
                  className="playback-progress absolute inset-x-0 bottom-0 h-1 w-full"
                />
              </span>
              <span className="block p-3">
                <span className="block truncate text-sm font-semibold">{item.episodeTitle}</span>
                <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{item.showTitle}</span>
                  <span className="shrink-0">{formatDuration(remaining)} left</span>
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label={`Remove ${item.episodeTitle} from Continue Watching`}
              title="Remove from Continue Watching"
              className="invisible absolute right-2 top-2 z-10 rounded-full border border-border bg-black p-2 text-muted-foreground group-hover:visible group-focus-within:visible hover:text-foreground focus:visible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" />
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={handleDismiss}>
            <X className="size-4" />
            Remove from Continue Watching
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}

export function useContinueWatchingItems(
  shows: readonly ShowGroup[],
  metadata: ShowMetadata,
  progress: PlaybackProgressMap,
): readonly ContinueWatchingItem[] {
  return useMemo(
    () => buildContinueWatchingItems(shows, metadata, progress),
    [shows, metadata, progress],
  );
}

interface ContinueWatchingProps {
  readonly items: readonly ContinueWatchingItem[];
  readonly onSelect: (entry: MediaEntry) => void;
}

export function ContinueWatching({
  items,
  onSelect,
}: ContinueWatchingProps): React.JSX.Element | null {
  const dismiss = useDismissPlaybackProgress();
  const handleDismiss = useCallback((rel: string) => {
    dismiss.mutate(rel);
  }, [dismiss]);
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="mb-10">
      <div className="mb-4">
        <h2 className="text-xl font-bold tracking-tight">Continue Watching</h2>
        {dismiss.error !== null && (
          <p className="mt-2 select-text text-sm text-destructive">
            Could not dismiss item: {dismiss.error.message}
          </p>
        )}
      </div>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <ContinueCard
            key={item.entry.rel}
            item={item}
            onSelect={onSelect}
            onDismiss={handleDismiss}
          />
        ))}
      </ul>
    </section>
  );
}
