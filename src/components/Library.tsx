import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type {
  AniListMedia,
  MediaEntry,
  PlaybackProgressMap,
  ShowMetadata,
  TorrentStatus,
} from "../types.ts";
import {
  seasonMetadataKey,
  isMovieMedia,
  primaryShowMetadata,
  showMetadataKey,
  type SeasonGroup,
  type ShowGroup,
} from "../lib/library.ts";
import { AniListLinkDialog } from "./AniListLinkDialog.tsx";
import {
  useContinueWatchingItems,
  type ContinueWatchingItem,
} from "./ContinueWatching.tsx";
import { ShowPage } from "./ShowPage.tsx";
import { MoviePage } from "./MoviePage.tsx";
import { useTorrents } from "../hooks/useTorrents.ts";
import { LibraryHome } from "./LibraryHome.tsx";

export { RouteLibrarySkeleton } from "./LibrarySkeletons.tsx";

const EMPTY_TORRENTS: readonly TorrentStatus[] = [];

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

type LinkTarget =
  | { readonly type: "show" }
  | { readonly type: "season"; readonly season: SeasonGroup };

interface SelectedTitleProps {
  readonly show: ShowGroup;
  readonly media: AniListMedia | undefined;
  readonly metadata: ShowMetadata;
  readonly progress: PlaybackProgressMap;
  readonly onBack: () => void;
  readonly onShowLink?: (() => void) | undefined;
  readonly onSeasonLink?: ((season: SeasonGroup) => void) | undefined;
  readonly onSelect: (entry: MediaEntry) => void;
  readonly canTranscode: boolean;
}

function SelectedTitle({
  show,
  media,
  metadata,
  progress,
  canTranscode,
  onBack,
  onShowLink,
  onSeasonLink,
  onSelect,
}: SelectedTitleProps): React.JSX.Element {
  if (isMovieMedia(media)) {
    return (
      <MoviePage
        movie={show}
        media={media}
        progress={progress}
        onBack={onBack}
        onLink={onShowLink}
        onPlay={onSelect}
      />
    );
  }
  return (
    <ShowPage
      show={show}
      media={media}
      metadata={metadata}
      progress={progress}
      canTranscode={canTranscode}
      onBack={onBack}
      onShowLink={onShowLink}
      onSeasonLink={onSeasonLink}
      onEpisodeSelect={onSelect}
    />
  );
}

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

function selectedDisplayName(show: ShowGroup | null, media: AniListMedia | undefined): string {
  if (show === null) {
    return "";
  }
  return media === undefined ? show.name : displayMediaTitle(media);
}

function suggestedMetadataSearch(target: LinkTarget | null, displayName: string): string {
  if (target?.type === "season" && target.season.name !== "Episodes") {
    return `${displayName} ${target.season.name}`;
  }
  return displayName;
}

interface LibraryViewProps extends Pick<
  LibraryProps,
  "canManageMappings" | "entries" | "metadata" | "onSelect" | "onShowSelect" |
  "onShowsBack" | "progress" | "query"
> {
  readonly continueWatching: readonly ContinueWatchingItem[];
  readonly downloads: readonly TorrentStatus[];
  readonly selectedShow: ShowGroup | null;
  readonly showMedia: AniListMedia | undefined;
  readonly shows: readonly ShowGroup[];
  readonly navigation: ReturnType<typeof useLibraryNavigation>;
}

function LibraryView(props: LibraryViewProps): React.JSX.Element {
  if (props.selectedShow !== null) {
    return (
      <SelectedTitle show={props.selectedShow} media={props.showMedia} metadata={props.metadata} progress={props.progress} canTranscode={props.canManageMappings} onBack={props.onShowsBack} onShowLink={props.canManageMappings ? props.navigation.handleShowLink : undefined} onSeasonLink={props.canManageMappings ? props.navigation.handleSeasonLink : undefined} onSelect={props.onSelect} />
    );
  }
  return (
    <LibraryHome entries={props.entries} shows={props.shows} metadata={props.metadata} continueWatching={props.continueWatching} progress={props.progress} showContinueWatching={props.query.trim() === ""} onShowSelect={props.onShowSelect} onEpisodeSelect={props.onSelect} downloads={props.downloads} />
  );
}

function MetadataLinkDialog({
  canManageMappings,
  dialogKey,
  metadata,
  navigation,
  suggestedSearch,
}: {
  readonly canManageMappings: boolean;
  readonly dialogKey: string | null;
  readonly metadata: ShowMetadata;
  readonly navigation: ReturnType<typeof useLibraryNavigation>;
  readonly suggestedSearch: string;
}): React.JSX.Element | null {
  if (!canManageMappings || navigation.linkTarget === null || dialogKey === null) {
    return null;
  }
  return (
    <AniListLinkDialog currentMedia={metadata[dialogKey]} initialProvider={metadata[dialogKey]?.provider ?? "anilist"} metadataKey={dialogKey} suggestedSearch={suggestedSearch} subject={navigation.linkTarget.type} onClose={navigation.handleLinkClose} />
  );
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
  const torrents = useTorrents(canManageMappings && selectedShow === null);
  const continueWatching = useContinueWatchingItems(allShows, metadata, progress);
  const showMedia = selectedShow === null
    ? undefined
    : primaryShowMetadata(selectedShow, metadata);
  const displayShowName = selectedDisplayName(selectedShow, showMedia);
  const dialogKey = linkMetadataKey(selectedShow, navigation.linkTarget);
  const suggestedSearch = suggestedMetadataSearch(navigation.linkTarget, displayShowName);
  return (
    <>
      <LibraryView canManageMappings={canManageMappings} entries={entries} metadata={metadata} onSelect={onSelect} onShowSelect={onShowSelect} onShowsBack={onShowsBack} progress={progress} query={query} continueWatching={continueWatching} downloads={torrents.data ?? EMPTY_TORRENTS} selectedShow={selectedShow} showMedia={showMedia} shows={shows} navigation={navigation} />
      <MetadataLinkDialog canManageMappings={canManageMappings} dialogKey={dialogKey} metadata={metadata} navigation={navigation} suggestedSearch={suggestedSearch} />
    </>
  );
}
