import { useCallback, useMemo, type MouseEvent } from "react";
import { formatDuration } from "../format.ts";
import { libraryEpisodeHref, navigateToLibraryEpisode } from "../hooks/useMediaRoute.ts";
import { preloadPlayer } from "../lib/playback.ts";
import { episodeShortLabel, recentlyWatched, type RecentEpisode } from "../lib/profileMedia.ts";
import { usePlaybackProgress } from "../hooks/usePlaybackProgress.ts";
import { useProfileEpisodes, useProfileEpisodesPending } from "../hooks/useProfileEpisodes.ts";
import type { PlaybackProgressMap } from "../types.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";
import { Bone } from "./Skeleton.tsx";

const NO_PROGRESS: PlaybackProgressMap = {};
const RECENT_LIMIT = 4;

export interface RecentlyWatchedState {
  readonly items: readonly RecentEpisode[];
  /** Library, metadata or progress still loading, so the list isn't known yet. */
  readonly pending: boolean;
}

export function useRecentlyWatched(): RecentlyWatchedState {
  const episodes = useProfileEpisodes();
  const episodesPending = useProfileEpisodesPending();
  const progress = usePlaybackProgress();
  const saved = progress.data ?? NO_PROGRESS;
  const items = useMemo(() => recentlyWatched(episodes, saved, RECENT_LIMIT), [episodes, saved]);
  return { items, pending: episodesPending || progress.isPending };
}

const PLACEHOLDER_KEYS = ["one", "two", "three", "four"] as const;

/** Holds the section's place while it loads, so the settings below don't jump down when it fills in. */
function RecentlyWatchedPlaceholder(): React.JSX.Element {
  return (
    <section aria-hidden="true" className="mt-10">
      <Bone className="h-6 w-44" />
      <ul className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {PLACEHOLDER_KEYS.map((key) => (
          <li key={key}>
            <Bone className="aspect-video w-full rounded-lg" />
            <Bone className="mt-2.5 h-4 w-3/4" />
            <Bone className="mt-1.5 h-3 w-1/2" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function progressLabel({ episode, progress }: RecentEpisode): string {
  const label = episodeShortLabel(episode);
  const status = progress.completed
    ? "Watched"
    : `${formatDuration(Math.max(progress.duration - progress.position, 0))} left`;
  return label === "" ? status : `${label} · ${status}`;
}

function RecentTile({ item }: { readonly item: RecentEpisode }): React.JSX.Element {
  const { episode, progress } = item;
  const handleClick = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    navigateToLibraryEpisode(episode.rel);
  }, [episode.rel]);
  const percent = !progress.completed && progress.duration > 0
    ? Math.min(100, progress.position / progress.duration * 100)
    : 0;
  return (
    <li className="min-w-0">
      <a
        href={libraryEpisodeHref(episode.rel)}
        onClick={handleClick}
        onFocus={preloadPlayer}
        onPointerEnter={preloadPlayer}
        className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="relative block overflow-hidden rounded-lg">
          <MediaThumbnail rel={episode.rel} source={episode.thumbnail} className="w-full transition-transform duration-300 group-hover:scale-[1.03] group-focus-visible:scale-[1.03]" />
          {percent > 0 && (
            <progress aria-label="Playback progress" max={100} value={percent} className="playback-progress absolute inset-x-0 bottom-0 h-1 w-full" />
          )}
        </span>
        <span className="mt-2 block truncate text-sm font-medium">{episode.showTitle}</span>
        <span className="block truncate text-[13px] text-muted-foreground">{progressLabel(item)}</span>
      </a>
    </li>
  );
}

export function RecentlyWatched({ items, pending }: RecentlyWatchedState): React.JSX.Element | null {
  if (pending) {
    return <RecentlyWatchedPlaceholder />;
  }
  if (items.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="recently-watched-title" className="mt-10">
      <h2 id="recently-watched-title" className="font-display text-xl font-bold tracking-tight">Recently watched</h2>
      <ul className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {items.map((item) => <RecentTile key={item.episode.rel} item={item} />)}
      </ul>
    </section>
  );
}
