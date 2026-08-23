import { useCallback, type ChangeEvent } from "react";
import type { AuthUser, MediaEntry, ShowMetadata } from "../types.ts";
import {
  aniListPlaybackTarget,
  nextEpisode,
  previousEpisode,
  type ShowGroup,
} from "../lib/library.ts";
import { useLibrary } from "../hooks/useLibrary.ts";
import { usePlaybackProgress } from "../hooks/usePlaybackProgress.ts";
import { useShowMetadata } from "../hooks/useShowMetadata.ts";
import {
  closeEpisode,
  navigateToEpisode,
  navigateToShow,
  navigateToShows,
  updateSearch,
  useMediaRoute,
} from "../hooks/useMediaRoute.ts";
import { Library } from "./Library.tsx";
import { Player } from "./Player.tsx";
import { MediaHeader } from "./MediaHeader.tsx";

const EMPTY_PROGRESS = {};

interface MediaAppProps {
  readonly user: AuthUser;
}

function useAdjacentEpisodeNavigation(
  entries: readonly MediaEntry[] | undefined,
  selected: MediaEntry | null,
  metadata: ShowMetadata,
): {
  readonly previous: MediaEntry | null;
  readonly next: MediaEntry | null;
  readonly handlePrevious: () => void;
  readonly handleNext: () => void;
} {
  const previous = entries === undefined || selected === null
    ? null
    : previousEpisode(entries, selected.rel, metadata);
  const next = entries === undefined || selected === null
    ? null
    : nextEpisode(entries, selected.rel, metadata);
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
  return { previous, next, handlePrevious, handleNext };
}

export function MediaApp({ user }: MediaAppProps): React.JSX.Element {
  const library = useLibrary();
  const playbackProgress = usePlaybackProgress();
  const metadata = useShowMetadata();
  const route = useMediaRoute();
  const selected = library.data?.find((entry) => entry.rel === route.episodeRel) ?? null;
  const navigation = useAdjacentEpisodeNavigation(library.data, selected, metadata.data ?? {});
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
        onQueryChange={handleQueryChange}
      />
      <main className="mx-auto max-w-7xl px-6 py-6">
        {library.status === "pending" && (
          <p className="py-16 text-center text-muted-foreground">Loading library…</p>
        )}
        {library.status === "error" && (
          <p className="py-16 text-center text-destructive">
            Failed to load library: {library.error.message}
          </p>
        )}
        {library.status === "success" && (
          <Library
            entries={library.data}
            query={route.query}
            progress={playbackProgress.data ?? EMPTY_PROGRESS}
            selectedShowName={route.showName}
            onSelect={handleSelect}
            onShowSelect={handleShowSelect}
            onShowsBack={navigateToShows}
            canDelete={user.isAdmin}
            canManageMappings={user.isAdmin}
          />
        )}
      </main>
      {selected !== null && (
        <Player
          key={selected.rel}
          entry={selected}
          anilistTarget={aniListPlaybackTarget(library.data, selected, metadata.data ?? {})}
          nextAvailable={navigation.next !== null}
          previousAvailable={navigation.previous !== null}
          initialProgress={playbackProgress.data?.[selected.rel]}
          onClose={closeEpisode}
          onNext={navigation.handleNext}
          onPrevious={navigation.handlePrevious}
        />
      )}
    </div>
  );
}
