import { lazy, Suspense, useCallback, type ChangeEvent } from "react";
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
import { Library, LibrarySkeleton } from "./Library.tsx";
import { MediaHeader } from "./MediaHeader.tsx";
import { loadPlayer } from "../routeModules.ts";
import { useLibraryIndex, type LibraryIndex } from "../hooks/useLibraryIndex.ts";

const Player = lazy(async () => {
  const module = await loadPlayer();
  return { default: module.Player };
});

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

export function MediaApp({ user }: MediaAppProps): React.JSX.Element {
  const library = useLibrary();
  const playbackProgress = usePlaybackProgress();
  const route = useMediaRoute();
  const index = useLibraryIndex(library.data ?? EMPTY_ENTRIES);
  const navigation = useEpisodeNavigation(index, route.episodeRel);
  const mediaDuration = useMediaDuration(navigation.selected?.rel ?? null);
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
    <div className="min-h-screen bg-background text-foreground">
      <MediaHeader
        user={user}
        view="library"
        query={route.query}
        shows={index.shows}
        metadata={index.metadata}
        onQueryChange={handleQueryChange}
        onShowSelect={handleShowSelect}
      />
      <main className="mx-auto max-w-7xl px-6 py-6">
        {(library.status === "pending" || library.status === "success" && index.metadataPending) && (
          <LibrarySkeleton />
        )}
        {library.status === "error" && (
          <p className="py-16 text-center text-destructive">
            Failed to load library: {library.error.message}
          </p>
        )}
        {library.status === "success" && index.metadataError !== null && (
          <p className="py-16 text-center text-destructive">
            Failed to load metadata: {index.metadataError.message}
          </p>
        )}
        {library.status === "success" && !index.metadataPending && index.metadataError === null && (
          <Library
            entries={library.data}
            shows={index.shows}
            unmappedShows={index.unmappedShows}
            metadata={index.metadata}
            query={route.query}
            progress={playbackProgress.data ?? EMPTY_PROGRESS}
            selectedShowName={route.showName}
            onSelect={handleSelect}
            onShowSelect={handleShowSelect}
            onShowsBack={navigateToShows}
            canManageMappings={user.isAdmin}
          />
        )}
      </main>
      {navigation.selected !== null && playbackProgress.status !== "pending" && (
        mediaDuration.status === "pending" ? PLAYER_LOADING : (
          <Suspense fallback={PLAYER_LOADING}>
            <Player
              key={navigation.selected.rel}
              entry={navigation.selected}
              episodeDisplay={navigation.display}
              anilistTarget={navigation.target}
              nextAvailable={navigation.next !== null}
              previousAvailable={navigation.previous !== null}
              initialProgress={playbackProgress.data?.[navigation.selected.rel]}
              knownDuration={mediaDuration.status === "success"
                ? mediaDuration.data
                : playbackProgress.data?.[navigation.selected.rel]?.duration ?? 0}
              onClose={closeEpisode}
              onNext={navigation.handleNext}
              onPrevious={navigation.handlePrevious}
            />
          </Suspense>
        )
      )}
    </div>
  );
}
