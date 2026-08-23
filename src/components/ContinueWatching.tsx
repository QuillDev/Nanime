import { useCallback, useMemo } from "react";
import { Play, X } from "lucide-react";
import type {
  MediaEntry,
  PlaybackProgress,
  PlaybackProgressMap,
  ShowMetadata,
} from "../types.ts";
import { formatDuration } from "../format.ts";
import { episodeMetadata } from "../lib/anilist.ts";
import { hasMeaningfulPlaybackProgress, preloadPlayer } from "../lib/playback.ts";
import { useDismissPlaybackProgress } from "../hooks/usePlaybackProgress.ts";
import {
  groupShows,
  seasonMetadata,
  seasonNumber,
  showMetadataKey,
} from "../lib/library.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/ContextMenu.tsx";

export interface ContinueWatchingItem {
  readonly entry: MediaEntry;
  readonly progress: PlaybackProgress;
  readonly showTitle: string;
  readonly episodeTitle: string;
  readonly thumbnail: string | null | undefined;
}

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

function showTitle(metadata: ShowMetadata, localName: string): string {
  const media = metadata[showMetadataKey(localName)];
  return media === undefined ? localName : media.title.english ?? media.title.romaji;
}

function buildContinueWatchingItems(
  entries: readonly MediaEntry[],
  metadata: ShowMetadata,
  progress: PlaybackProgressMap,
): readonly ContinueWatchingItem[] {
  return groupShows(entries, metadata).flatMap((show) => show.seasons.flatMap((season) => {
    const media = seasonMetadata(metadata, season.sourceShow, season.name);
    const showMedia = metadata[showMetadataKey(show.name)];
    return season.entries.flatMap((entry) => {
      const saved = progress[entry.rel];
      if (
        saved === undefined ||
        saved.completed ||
        saved.dismissedAt !== null && saved.dismissedAt >= saved.updatedAt ||
        !hasMeaningfulPlaybackProgress(saved.position)
      ) {
        return [];
      }
      const details = episodeMetadata(entry, media, {
        showMedia,
        season: seasonNumber(season, media),
      });
      return [{
        entry,
        progress: saved,
        showTitle: showTitle(metadata, show.name),
        episodeTitle: details?.title ?? entry.name,
        thumbnail: details?.thumbnail,
      }];
    });
  })).toSorted((a, b) => b.progress.updatedAt - a.progress.updatedAt).slice(0, 8);
}

export function useContinueWatchingItems(
  entries: readonly MediaEntry[],
  metadata: ShowMetadata,
  progress: PlaybackProgressMap,
): readonly ContinueWatchingItem[] {
  return useMemo(
    () => buildContinueWatchingItems(entries, metadata, progress),
    [entries, metadata, progress],
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
