import { useCallback, useMemo, useState } from "react";
import type {
  MediaEntry,
  PlaybackProgressMap,
  ShowMetadata,
  DownloadStatus,
} from "../types.ts";
import type { ShowGroup } from "../lib/library.ts";
import type { ContinueWatchingItem } from "../lib/continueWatching.ts";
import { SHOW_FILTERS, filterShows, homeFeatures, sortByLastWatched, watchedShowNames, type ShowFilter } from "../lib/libraryHome.ts";
import { useDismissPlaybackProgress } from "../hooks/usePlaybackProgress.ts";
import { HomeHero } from "./HomeHero.tsx";
import { ShowFilters } from "./ShowFilters.tsx";
import { ShowWall } from "./ShowWall.tsx";

interface LibraryHomeProps {
  readonly continueWatching: readonly ContinueWatchingItem[];
  readonly downloads: readonly DownloadStatus[];
  readonly entries: readonly MediaEntry[];
  readonly metadata: ShowMetadata;
  readonly onEpisodeSelect: (entry: MediaEntry) => void;
  readonly onShowSelect: (show: ShowGroup) => void;
  readonly progress: PlaybackProgressMap;
  /** False while searching: the banner and rows give way to plain results. */
  readonly showContinueWatching: boolean;
  readonly shows: readonly ShowGroup[];
}

/** Chosen once per visit, so the banner's random show stays put while the page is open. */
const VISIT_PICK = Math.random();

function filterLabel(filter: ShowFilter): string {
  return SHOW_FILTERS.find((option) => option.key === filter)?.label ?? "";
}

function useHomeSections(props: LibraryHomeProps) {
  const { continueWatching, metadata, progress, showContinueWatching, shows } = props;
  const [filter, setFilter] = useState<ShowFilter>("all");
  const watchedNames = useMemo(() => watchedShowNames(shows, progress), [progress, shows]);
  const isWatched = useCallback((show: ShowGroup) => watchedNames.has(show.name), [watchedNames]);
  const filtered = useMemo(() => {
    const kept = filterShows(shows, filter, { metadata, progress });
    return filter === "watching" ? sortByLastWatched(kept, progress) : kept;
  }, [filter, metadata, progress, shows]);
  const features = useMemo(
    () => (showContinueWatching ? homeFeatures(continueWatching, shows, { metadata, progress, pick: VISIT_PICK }) : []),
    [continueWatching, metadata, progress, showContinueWatching, shows],
  );
  const dismiss = useDismissPlaybackProgress();
  const handleDismiss = useCallback((rel: string) => {
    dismiss.mutate(rel);
  }, [dismiss]);
  return { features, filtered, isWatched, filter, setFilter, handleDismiss, dismissError: dismiss.error };
}

export function LibraryHome(props: LibraryHomeProps): React.JSX.Element {
  const { downloads, entries, metadata, onEpisodeSelect, onShowSelect, showContinueWatching, shows } = props;
  const { features, filtered, isWatched, filter, setFilter, handleDismiss, dismissError } = useHomeSections(props);

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
  if (!showContinueWatching) {
    return <ShowWall downloads={downloads} metadata={metadata} onShowSelect={onShowSelect} shows={shows} title="Results" watched={isWatched} beside={false} ordered={false} />;
  }
  return (
    <>
      <HomeHero features={features} onEpisodeSelect={onEpisodeSelect} onShowSelect={onShowSelect} onDismiss={handleDismiss} />
      {dismissError !== null && (
        <p role="alert" className="mt-4 select-text text-sm text-destructive">Could not dismiss item: {dismissError.message}</p>
      )}
      <div className={features.length === 0 ? undefined : "mt-10"}>
        <div className="lg:grid lg:grid-cols-[10.5rem_minmax(0,1fr)] lg:gap-10">
          <ShowFilters filter={filter} onFilter={setFilter} />
          <ShowWall downloads={downloads} metadata={metadata} onShowSelect={onShowSelect} shows={filtered} title={filterLabel(filter)} watched={isWatched} beside ordered={filter === "watching"} />
        </div>
      </div>
    </>
  );
}
