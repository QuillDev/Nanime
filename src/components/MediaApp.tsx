import { Suspense, useCallback, useEffect, type ChangeEvent } from "react";
import type { AuthUser, MediaEntry } from "../types.ts";
import type { ShowGroup } from "../lib/library.ts";
import { useLibrary, useMediaDuration } from "../hooks/useLibrary.ts";
import { usePlaybackProgress } from "../hooks/usePlaybackProgress.ts";
import {
  closeEpisode,
  navigateToEpisode,
  navigateToShow,
  navigateToShows,
  updateSearch,
  useMediaRoute,
} from "../hooks/useMediaRoute.ts";
import { Library, RouteLibrarySkeleton } from "./Library.tsx";
import { MediaHeader } from "./MediaHeader.tsx";
import { PlaybackGateChunk, PlayerChunk, preloadPlayerWhenIdle } from "../routeModules.ts";
import { useLibraryIndex, type LibraryIndex } from "../hooks/useLibraryIndex.ts";

const Player = PlayerChunk.Component;
const PlaybackGate = PlaybackGateChunk.Component;

const PLAYER_LOADING = (
  <output
    className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black text-sm text-muted-foreground"
  >
    <span className="skeleton h-1 w-48 rounded-full" aria-hidden="true" />
    Preparing player…
  </output>
);

const EMPTY_PROGRESS = {};
const EMPTY_ENTRIES: readonly MediaEntry[] = [];

interface MediaAppProps {
  readonly user: AuthUser;
}

function useEpisodeNavigation(index: LibraryIndex, rel: string | null) {
  const selected = rel === null ? null : index.entriesByRel.get(rel) ?? null;
  const previous = rel === null ? null : index.previousByRel.get(rel) ?? null;
  const next = rel === null ? null : index.nextByRel.get(rel) ?? null;
  const handlePrevious = useCallback(() => {
    if (previous !== null) {
      navigateToEpisode(previous.rel);
    }
  }, [previous]);
  const handleNext = useCallback(() => {
    if (next !== null) {
      navigateToEpisode(next.rel);
    }
  }, [next]);
  return {
    selected,
    previous,
    next,
    target: rel === null ? null : index.playbackTargetByRel.get(rel) ?? null,
    display: rel === null ? null : index.displayByRel.get(rel) ?? null,
    handlePrevious,
    handleNext,
  };
}

function usePreparedEpisode(index: LibraryIndex, rel: string | null, libraryShown: boolean) {
  // Warm the player only after the page's own data has arrived.
  useEffect(() => (libraryShown ? preloadPlayerWhenIdle() : undefined), [libraryShown]);
  const navigation = useEpisodeNavigation(index, rel);
  const mediaDuration = useMediaDuration(navigation.selected?.rel ?? null);
  return { navigation, mediaDuration };
}

interface LibraryContentProps {
  readonly library: ReturnType<typeof useLibrary>;
  readonly index: LibraryIndex;
  readonly progress: ReturnType<typeof usePlaybackProgress>;
  readonly route: ReturnType<typeof useMediaRoute>;
  readonly user: AuthUser;
  readonly onSelect: (entry: MediaEntry) => void;
  readonly onShowSelect: (show: ShowGroup) => void;
}

function LibraryContent({ library, index, progress, route, user, onSelect, onShowSelect }: LibraryContentProps): React.JSX.Element {
  if (library.status === "pending" || library.status === "success" && index.metadataPending) {
    return <RouteLibrarySkeleton showName={route.showName} query={route.query} />;
  }
  if (library.status === "error") {
    return <p className="py-16 text-center text-destructive">Failed to load library: {library.error.message}</p>;
  }
  if (index.metadataError !== null) {
    return <p className="py-16 text-center text-destructive">Failed to load metadata: {index.metadataError.message}</p>;
  }
  return (
    <Library entries={library.data} shows={index.shows} metadata={index.metadata} query={route.query} progress={progress.data ?? EMPTY_PROGRESS} selectedShowName={route.showName} onSelect={onSelect} onShowSelect={onShowSelect} onShowsBack={navigateToShows} canManageMappings={user.isAdmin} />
  );
}

function seasonStreamPaths(entries: readonly MediaEntry[] | undefined, selected: MediaEntry): readonly string[] {
  return (entries ?? []).flatMap((entry) => (
    entry.folder === selected.folder && !entry.direct ? [entry.rel] : []
  ));
}

function PlayerLayer({
  navigation,
  progress,
  mediaDuration,
  preferredAudioLanguage,
  entries,
  canTranscode,
}: {
  readonly navigation: ReturnType<typeof useEpisodeNavigation>;
  readonly progress: ReturnType<typeof usePlaybackProgress>;
  readonly mediaDuration: ReturnType<typeof useMediaDuration>;
  readonly preferredAudioLanguage: AuthUser["preferredAudioLanguage"];
  readonly entries: readonly MediaEntry[] | undefined;
  readonly canTranscode: boolean;
}): React.JSX.Element | null {
  if (navigation.selected === null || progress.status === "pending") {
    return null;
  }
  const initialProgress = progress.data?.[navigation.selected.rel];
  const knownDuration = mediaDuration.status === "success"
    ? mediaDuration.data
    : initialProgress?.duration ?? 0;
  return (
    <Suspense fallback={PLAYER_LOADING}>
      <PlaybackGate key={navigation.selected.rel} entry={navigation.selected} canTranscode={canTranscode} seasonPaths={seasonStreamPaths(entries, navigation.selected)} onClose={closeEpisode}>
        <Player key={navigation.selected.rel} entry={navigation.selected} episodeDisplay={navigation.display} anilistTarget={navigation.target} nextAvailable={navigation.next !== null} previousAvailable={navigation.previous !== null} initialProgress={initialProgress} knownDuration={knownDuration} preferredAudioLanguage={preferredAudioLanguage} onClose={closeEpisode} onNext={navigation.handleNext} onPrevious={navigation.handlePrevious} />
      </PlaybackGate>
    </Suspense>
  );
}

export function MediaApp({ user }: MediaAppProps): React.JSX.Element {
  const library = useLibrary();
  const playbackProgress = usePlaybackProgress();
  const route = useMediaRoute();
  const index = useLibraryIndex(library.data ?? EMPTY_ENTRIES);
  const libraryShown = library.status === "success" && !index.metadataPending;
  const { navigation, mediaDuration } = usePreparedEpisode(index, route.episodeRel, libraryShown);
  const handleQueryChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    updateSearch(event.target.value);
  }, []);
  const handleSelect = useCallback((entry: MediaEntry) => {
    navigateToEpisode(entry.rel);
  }, []);
  const handleShowSelect = useCallback((show: ShowGroup) => {
    navigateToShow(show.name);
  }, []);

  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground">
      <MediaHeader
        user={user}
        view="library"
        query={route.query}
        shows={index.shows}
        metadata={index.metadata}
        onQueryChange={handleQueryChange}
        onShowSelect={handleShowSelect}
        overlay={route.showName === null && route.query.trim() === ""}
      />
      <main className="mx-auto max-w-7xl px-6 py-6">
        <LibraryContent library={library} index={index} progress={playbackProgress} route={route} user={user} onSelect={handleSelect} onShowSelect={handleShowSelect} />
      </main>
      <PlayerLayer navigation={navigation} progress={playbackProgress} mediaDuration={mediaDuration} preferredAudioLanguage={user.preferredAudioLanguage} entries={library.data} canTranscode={user.isAdmin} />
    </div>
  );
}
