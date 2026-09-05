import { useMemo } from "react";
import type {
  MediaEntry,
  PlaybackProgressMap,
  ShowMetadata,
  TorrentStatus,
} from "../types.ts";
import type { ShowGroup } from "../lib/library.ts";
import { partitionShowsByWatched } from "../lib/watchedShows.ts";
import {
  ContinueWatching,
  type ContinueWatchingItem,
} from "./ContinueWatching.tsx";
import { ShowGrid } from "./ShowGrid.tsx";
import { ShelfHeading } from "./ShelfHeading.tsx";

interface LibraryHomeProps {
  readonly continueWatching: readonly ContinueWatchingItem[];
  readonly downloads: readonly TorrentStatus[];
  readonly entries: readonly MediaEntry[];
  readonly metadata: ShowMetadata;
  readonly onEpisodeSelect: (entry: MediaEntry) => void;
  readonly onShowSelect: (show: ShowGroup) => void;
  readonly progress: PlaybackProgressMap;
  readonly showContinueWatching: boolean;
  readonly shows: readonly ShowGroup[];
}

export function LibraryHome({
  continueWatching,
  downloads,
  entries,
  metadata,
  onEpisodeSelect,
  onShowSelect,
  progress,
  showContinueWatching,
  shows,
}: LibraryHomeProps): React.JSX.Element {
  const homeShows = useMemo(() => (
    partitionShowsByWatched(shows, progress)
  ), [progress, shows]);
  if (entries.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        No videos found yet. Downloads will appear here automatically.
      </p>
    );
  }
  if (homeShows.unwatched.length === 0 && homeShows.watched.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        {showContinueWatching ? "No mapped shows available yet." : "No matches for your search."}
      </p>
    );
  }
  return (
    <>
      {showContinueWatching && (
        <ContinueWatching items={continueWatching} onSelect={onEpisodeSelect} />
      )}
      {homeShows.unwatched.length > 0 && (
        <section>
          <ShelfHeading count={homeShows.unwatched.length} title="Shows" />
          <ShowGrid
            shows={homeShows.unwatched}
            metadata={metadata}
            downloads={downloads}
            onSelect={onShowSelect}
          />
        </section>
      )}
      {homeShows.watched.length > 0 && (
        <section className="mt-14 border-t border-border pt-8 sm:pt-10">
          <ShelfHeading count={homeShows.watched.length} title="Watched" />
          <ShowGrid
            shows={homeShows.watched}
            metadata={metadata}
            downloads={downloads}
            onSelect={onShowSelect}
            watched
          />
        </section>
      )}
    </>
  );
}
