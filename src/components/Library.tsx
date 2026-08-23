import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type {
  AniListMedia,
  MediaEntry,
  PlaybackProgressMap,
  ShowMetadata,
} from "../types.ts";
import {
  seasonMetadataKey,
  showMetadataKey,
  type SeasonGroup,
  type ShowGroup,
} from "../lib/library.ts";
import { AniListLinkDialog } from "./AniListLinkDialog.tsx";
import {
  ContinueWatching,
  type ContinueWatchingItem,
  useContinueWatchingItems,
} from "./ContinueWatching.tsx";
import { ShowGrid } from "./ShowGrid.tsx";
import { ShowPage } from "./ShowPage.tsx";

export { LibrarySkeleton } from "./Skeleton.tsx";

interface LibraryProps {
  readonly entries: readonly MediaEntry[];
  readonly shows: readonly ShowGroup[];
  readonly metadata: ShowMetadata;
  readonly query: string;
  readonly progress: PlaybackProgressMap;
  readonly selectedShowName: string | null;
  readonly onSelect: (entry: MediaEntry) => void;
  readonly onShowSelect: (show: ShowGroup) => void;
  readonly onShowsBack: () => void;
  readonly canManageMappings: boolean;
}

function matchesQuery(show: ShowGroup, needle: string): boolean {
  return (
    show.sourceNames.some((name) => name.toLowerCase().includes(needle)) ||
    show.entries.some((entry) => entry.name.toLowerCase().includes(needle))
  );
}

function displayMediaTitle(media: AniListMedia): string {
  return media.title.english ?? media.title.romaji;
}

interface HomePageProps {
  readonly entries: readonly MediaEntry[];
  readonly shows: readonly ShowGroup[];
  readonly metadata: ShowMetadata;
  readonly continueWatching: readonly ContinueWatchingItem[];
  readonly showContinueWatching: boolean;
  readonly onShowSelect: (show: ShowGroup) => void;
  readonly onEpisodeSelect: (entry: MediaEntry) => void;
}

function HomePage({
  entries,
  shows,
  metadata,
  continueWatching,
  showContinueWatching,
  onShowSelect,
  onEpisodeSelect,
}: HomePageProps): React.JSX.Element {
  if (entries.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        No videos found yet. Downloads will appear here automatically.
      </p>
    );
  }
  if (shows.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        No matches for your search.
      </p>
    );
  }
  return (
    <>
      {showContinueWatching && (
        <ContinueWatching items={continueWatching} onSelect={onEpisodeSelect} />
      )}
      <section>
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">Shows</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {shows.length} {shows.length === 1 ? "show" : "shows"}
          </p>
        </div>
        <ShowGrid shows={shows} metadata={metadata} onSelect={onShowSelect} />
      </section>
    </>
  );
}

type LinkTarget =
  | { readonly type: "show" }
  | { readonly type: "season"; readonly season: SeasonGroup };

function useLibraryNavigation() {
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const handleShowLink = useCallback(() => setLinkTarget({ type: "show" }), []);
  const handleSeasonLink = useCallback((season: SeasonGroup) => {
    setLinkTarget({ type: "season", season });
  }, []);
  const handleLinkClose = useCallback(() => setLinkTarget(null), []);
  return {
    linkTarget,
    handleShowLink,
    handleSeasonLink,
    handleLinkClose,
  };
}

function linkMetadataKey(show: ShowGroup | null, target: LinkTarget | null): string | null {
  if (show === null || target === null) {
    return null;
  }
  return target.type === "show"
    ? showMetadataKey(show.name)
    : seasonMetadataKey(target.season.sourceShow, target.season.name);
}

interface GroupedShows {
  readonly shows: readonly ShowGroup[];
  readonly selectedShow: ShowGroup | null;
}

interface GroupedShowsOptions {
  readonly shows: readonly ShowGroup[];
  readonly query: string;
  readonly selectedShowName: string | null;
}

function useGroupedShows(options: GroupedShowsOptions): GroupedShows {
  const { shows, query, selectedShowName } = options;
  const deferredQuery = useDeferredValue(query);
  return useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return {
      shows: needle === "" ? shows : shows.filter((show) => matchesQuery(show, needle)),
      selectedShow: shows.find((show) => (
        selectedShowName !== null && show.sourceNames.includes(selectedShowName)
      )) ?? null,
    };
  }, [deferredQuery, selectedShowName, shows]);
}

export function Library({
  entries,
  shows: allShows,
  metadata,
  query,
  progress,
  selectedShowName,
  onSelect,
  onShowSelect,
  onShowsBack,
  canManageMappings,
}: LibraryProps): React.JSX.Element {
  const navigation = useLibraryNavigation();
  const { shows, selectedShow } = useGroupedShows({
    shows: allShows,
    query,
    selectedShowName,
  });
  const continueWatching = useContinueWatchingItems(allShows, metadata, progress);
  const showMedia = selectedShow === null
    ? undefined
    : metadata[showMetadataKey(selectedShow.name)];
  const displayShowName = showMedia === undefined || selectedShow === null
    ? selectedShow?.name ?? ""
    : displayMediaTitle(showMedia);
  const dialogKey = linkMetadataKey(selectedShow, navigation.linkTarget);
  const suggestedSearch = navigation.linkTarget?.type === "season" &&
    navigation.linkTarget.season.name !== "Episodes"
    ? `${displayShowName} ${navigation.linkTarget.season.name}`
    : displayShowName;

  return (
    <>
      {selectedShow === null ? (
        <HomePage
          entries={entries}
          shows={shows}
          metadata={metadata}
          continueWatching={continueWatching}
          showContinueWatching={query.trim() === ""}
          onShowSelect={onShowSelect}
          onEpisodeSelect={onSelect}
        />
      ) : (
        <ShowPage
          show={selectedShow}
          media={showMedia}
          metadata={metadata}
          progress={progress}
          onBack={onShowsBack}
          onShowLink={canManageMappings ? navigation.handleShowLink : undefined}
          onSeasonLink={canManageMappings ? navigation.handleSeasonLink : undefined}
          onEpisodeSelect={onSelect}
        />
      )}
      {canManageMappings && navigation.linkTarget !== null && dialogKey !== null && (
        <AniListLinkDialog
          currentMedia={metadata[dialogKey]}
          initialProvider={metadata[dialogKey]?.provider ?? "anilist"}
          metadataKey={dialogKey}
          suggestedSearch={suggestedSearch}
          subject={navigation.linkTarget.type}
          onClose={navigation.handleLinkClose}
        />
      )}
    </>
  );
}
