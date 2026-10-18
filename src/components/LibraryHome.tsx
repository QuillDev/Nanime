import { useCallback, useMemo } from "react";
import type {
  MediaEntry,
  PlaybackProgressMap,
  ShowMetadata,
  TorrentStatus,
} from "../types.ts";
import type { ShowGroup } from "../lib/library.ts";
import type { ContinueWatchingItem } from "../lib/continueWatching.ts";
import { homeFeature, recentlyAddedShows, sortShows, watchedShowNames, type ShowSort } from "../lib/libraryHome.ts";
import { useDismissPlaybackProgress } from "../hooks/usePlaybackProgress.ts";
import { HomeHero } from "./HomeHero.tsx";
import { RecentlyAdded } from "./RecentlyAdded.tsx";
import { ShowGrid } from "./ShowGrid.tsx";
import { SortTabs, useShowSort } from "./SortTabs.tsx";

interface LibraryHomeProps {
  readonly continueWatching: readonly ContinueWatchingItem[];
  readonly downloads: readonly TorrentStatus[];
  readonly entries: readonly MediaEntry[];
  readonly metadata: ShowMetadata;
  readonly onEpisodeSelect: (entry: MediaEntry) => void;
  readonly onShowSelect: (show: ShowGroup) => void;
  readonly progress: PlaybackProgressMap;
  /** False while searching: the banner and rows give way to plain results. */
  readonly showContinueWatching: boolean;
  readonly shows: readonly ShowGroup[];
}

const QUEUE_SIZE = 3;

function useHomeSections(props: LibraryHomeProps, sort: ShowSort) {
  const { continueWatching, metadata, progress, showContinueWatching, shows } = props;
  const watchedNames = useMemo(() => watchedShowNames(shows, progress), [progress, shows]);
  const isWatched = useCallback((show: ShowGroup) => watchedNames.has(show.name), [watchedNames]);
  const sorted = useMemo(() => sortShows(shows, metadata, sort), [metadata, shows, sort]);
  const feature = showContinueWatching ? homeFeature(continueWatching, shows, metadata) : null;
  const queue = feature?.kind === "continue"
    ? continueWatching.filter((item) => item !== feature.item).slice(0, QUEUE_SIZE)
    : [];
  const recent = showContinueWatching ? recentlyAddedShows(shows, metadata) : [];
  return { feature, queue, recent, sorted, isWatched };
}

export function LibraryHome(props: LibraryHomeProps): React.JSX.Element {
  const { downloads, entries, metadata, onEpisodeSelect, onShowSelect, showContinueWatching, shows } = props;
  const [sort, setSort] = useShowSort();
  const dismiss = useDismissPlaybackProgress();
  const handleDismiss = useCallback((rel: string) => {
    dismiss.mutate(rel);
  }, [dismiss]);
  const { feature, queue, recent, sorted, isWatched } = useHomeSections(props, sort);

  if (entries.length === 0) {
    return <p className="py-16 text-center text-muted-foreground">No videos found yet. Downloads will appear here automatically.</p>;
  }
  if (shows.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        {showContinueWatching ? "No mapped shows available yet." : "No matches for your search."}
      </p>
    );
  }
  return (
    <>
      {feature !== null && (
        <HomeHero feature={feature} queue={queue} onEpisodeSelect={onEpisodeSelect} onShowSelect={onShowSelect} onDismiss={handleDismiss} />
      )}
      {dismiss.error !== null && (
        <p role="alert" className="mt-4 select-text text-sm text-destructive">Could not dismiss item: {dismiss.error.message}</p>
      )}
      <div className={feature === null ? undefined : "mt-10"}>
        {recent.length > 0 && <RecentlyAdded shows={recent} metadata={metadata} onSelect={onShowSelect} />}
        <section aria-labelledby="all-shows">
          <div className="mb-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <h2 id="all-shows" className="font-display text-2xl font-bold tracking-tight">{showContinueWatching ? "All shows" : "Results"}</h2>
            <span className="flex-1" />
            <SortTabs sort={sort} onSort={setSort} />
          </div>
          <ShowGrid shows={sorted} metadata={metadata} downloads={downloads} onSelect={onShowSelect} watched={isWatched} />
        </section>
      </div>
    </>
  );
}
