import { useCallback, useMemo, useState } from "react";
import type {
  AniListMedia,
  MediaEntry,
  PlaybackProgressMap,
  ShowMetadata,
} from "../types.ts";
import {
  groupShows,
  seasonMetadataKey,
  showMetadataKey,
  type SeasonGroup,
  type ShowGroup,
} from "../lib/library.ts";
import { useShowMetadata } from "../hooks/useShowMetadata.ts";
import { AniListLinkDialog } from "./AniListLinkDialog.tsx";
import {
  ContinueWatching,
  type ContinueWatchingItem,
  useContinueWatchingItems,
} from "./ContinueWatching.tsx";
import { ShowGrid } from "./ShowGrid.tsx";
import { DeleteMediaDialog, type DeleteMediaTarget } from "./DeleteMediaDialog.tsx";
import { ShowPage } from "./ShowPage.tsx";

const EMPTY_METADATA: ShowMetadata = {};

interface LibraryProps {
  readonly entries: readonly MediaEntry[];
  readonly query: string;
  readonly progress: PlaybackProgressMap;
  readonly selectedShowName: string | null;
  readonly onSelect: (entry: MediaEntry) => void;
  readonly onShowSelect: (show: ShowGroup) => void;
  readonly onShowsBack: () => void;
  readonly canDelete: boolean;
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

function useLibraryNavigation(): {
  readonly linkTarget: LinkTarget | null;
  readonly handleShowLink: () => void;
  readonly handleSeasonLink: (season: SeasonGroup) => void;
  readonly handleLinkClose: () => void;
} {
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

function useDeleteNavigation(onShowsBack: () => void): {
  readonly target: DeleteMediaTarget | null;
  readonly handleShowDelete: (show: ShowGroup) => void;
  readonly handleSeasonDelete: (season: SeasonGroup) => void;
  readonly handleEpisodeDelete: (entry: MediaEntry) => void;
  readonly handleClose: () => void;
  readonly handleDeleted: (returnToShows: boolean) => void;
} {
  const [target, setTarget] = useState<DeleteMediaTarget | null>(null);
  const handleShowDelete = useCallback((show: ShowGroup) => {
    setTarget({ label: `show “${show.name}”`, entries: show.entries, returnToShows: true });
  }, []);
  const handleSeasonDelete = useCallback((season: SeasonGroup) => {
    setTarget({ label: `season “${season.name}”`, entries: season.entries, returnToShows: false });
  }, []);
  const handleEpisodeDelete = useCallback((entry: MediaEntry) => {
    setTarget({ label: `episode “${entry.name}”`, entries: [entry], returnToShows: false });
  }, []);
  const handleClose = useCallback(() => setTarget(null), []);
  const handleDeleted = useCallback((returnToShows: boolean) => {
    setTarget(null);
    if (returnToShows) {
      onShowsBack();
    }
  }, [onShowsBack]);
  return {
    target,
    handleShowDelete,
    handleSeasonDelete,
    handleEpisodeDelete,
    handleClose,
    handleDeleted,
  };
}

function useLibraryControls(onShowsBack: () => void): {
  readonly navigation: ReturnType<typeof useLibraryNavigation>;
  readonly deletion: ReturnType<typeof useDeleteNavigation>;
} {
  const navigation = useLibraryNavigation();
  const deletion = useDeleteNavigation(onShowsBack);
  return { navigation, deletion };
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
  readonly entries: readonly MediaEntry[];
  readonly query: string;
  readonly selectedShowName: string | null;
  readonly metadata: ShowMetadata;
}

function useGroupedShows(options: GroupedShowsOptions): GroupedShows {
  const { entries, query, selectedShowName, metadata } = options;
  return useMemo(() => {
    const grouped = groupShows(entries, metadata);
    const needle = query.trim().toLowerCase();
    return {
      shows: needle === "" ? grouped : grouped.filter((show) => matchesQuery(show, needle)),
      selectedShow: grouped.find((show) => (
        selectedShowName !== null && show.sourceNames.includes(selectedShowName)
      )) ?? null,
    };
  }, [entries, query, selectedShowName, metadata]);
}

export function Library({
  entries,
  query,
  progress,
  selectedShowName,
  onSelect,
  onShowSelect,
  onShowsBack,
  canDelete,
}: LibraryProps): React.JSX.Element {
  const { navigation, deletion } = useLibraryControls(onShowsBack);
  const metadataQuery = useShowMetadata();
  const metadata = metadataQuery.data ?? EMPTY_METADATA;
  const { shows, selectedShow } = useGroupedShows({
    entries,
    query,
    selectedShowName,
    metadata,
  });
  const continueWatching = useContinueWatchingItems(entries, metadata, progress);
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
          onShowLink={navigation.handleShowLink}
          onSeasonLink={navigation.handleSeasonLink}
          onEpisodeSelect={onSelect}
          onShowDelete={canDelete ? deletion.handleShowDelete : undefined}
          onSeasonDelete={canDelete ? deletion.handleSeasonDelete : undefined}
          onEpisodeDelete={canDelete ? deletion.handleEpisodeDelete : undefined}
        />
      )}
      {navigation.linkTarget !== null && dialogKey !== null && (
        <AniListLinkDialog
          metadataKey={dialogKey}
          suggestedSearch={suggestedSearch}
          subject={navigation.linkTarget.type}
          onClose={navigation.handleLinkClose}
        />
      )}
      {deletion.target !== null && (
        <DeleteMediaDialog
          target={deletion.target}
          onClose={deletion.handleClose}
          onDeleted={deletion.handleDeleted}
        />
      )}
    </>
  );
}
