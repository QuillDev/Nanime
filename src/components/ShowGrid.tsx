import { useCallback, useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { AniListMedia, DownloadStatus, ShowMetadata } from "../types.ts";
import {
  primaryShowMetadata,
  type ShowGroup,
} from "../lib/library.ts";
import { mediaTitle } from "../lib/anilist.ts";
import { showFacts } from "../lib/libraryHome.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";
import { usePrefetchShowReadiness } from "../hooks/usePlaybackReadiness.ts";

interface ShowCardProps {
  readonly show: ShowGroup;
  readonly media: AniListMedia | undefined;
  readonly onSelect: (show: ShowGroup) => void;
  readonly downloadPercent: number | null;
  readonly watched: boolean;
}

const SHOW_BATCH_SIZE = 120;

function ShowCard({
  show,
  media,
  onSelect,
  downloadPercent,
  watched,
}: ShowCardProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelect(show);
  }, [onSelect, show]);
  const prefetch = usePrefetchShowReadiness(show);
  const [preview] = show.entries;
  const cover = media?.coverImage.large ?? media?.coverImage.extraLarge;
  const facts = showFacts(media);

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        onFocus={prefetch}
        onPointerEnter={prefetch}
        onPointerDown={prefetch}
        className="group w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="relative block">
          {preview !== undefined && (
            <MediaThumbnail rel={preview.rel} source={cover} watched={watched} className="aspect-[2/3] rounded-[10px] transition-transform duration-300 group-hover:scale-[1.02]" />
          )}
          {downloadPercent !== null && (
            <span className="absolute inset-x-2 bottom-2 rounded-lg bg-black/85 p-2 text-xs font-semibold text-foreground">
              <span className="flex items-center gap-1.5">
                <Download aria-hidden="true" className="size-3.5 animate-pulse text-primary" />
                <span>Downloading</span>
                <span className="ml-auto tabular-nums text-primary">{downloadPercent}%</span>
              </span>
              <progress
                aria-label={`${show.name} download progress`}
                max={100}
                value={downloadPercent}
                className="playback-progress mt-2 block h-1 w-full"
              />
            </span>
          )}
        </span>
        <span className="block pt-2">
          <span className="block truncate text-[13px] font-semibold group-hover:text-primary">
            {media === undefined ? show.name : mediaTitle(media)}
          </span>
          {facts !== null && <span className="block truncate text-xs text-muted-foreground">{facts}</span>}
        </span>
      </button>
    </div>
  );
}

interface ShowGridProps {
  readonly shows: readonly ShowGroup[];
  readonly metadata: ShowMetadata;
  readonly onSelect: (show: ShowGroup) => void;
  readonly downloads: readonly DownloadStatus[];
  readonly watched?: boolean | ((show: ShowGroup) => boolean);
}

function showTransitionName(name: string): string {
  let hash = 0;
  for (const character of name) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 2_147_483_647;
  }
  return `show-card-${hash.toString(36)}`;
}

interface DownloadTotals {
  readonly completed: number;
  readonly size: number;
}

function showDownloadTotals(
  show: ShowGroup,
  downloads: ReadonlyMap<string, DownloadTotals>,
): DownloadTotals | null {
  let completed = 0;
  let size = 0;
  let found = false;
  for (const sourceName of show.sourceNames) {
    const totals = downloads.get(sourceName);
    if (totals !== undefined) {
      completed += totals.completed;
      size += totals.size;
      found = true;
    }
  }
  return found ? { completed, size } : null;
}

function showDownloadPercent(
  show: ShowGroup,
  downloads: ReadonlyMap<string, DownloadTotals>,
): number | null {
  const totals = showDownloadTotals(show, downloads);
  if (totals === null) {
    return null;
  }
  return totals.size === 0
    ? 0
    : Math.round(Math.min(1, totals.completed / totals.size) * 100);
}

function indexDownloads(downloads: readonly DownloadStatus[]): ReadonlyMap<string, DownloadTotals> {
  const indexed = new Map<string, DownloadTotals>();
  for (const download of downloads) {
    if (download.showFolder !== null) {
      const current = indexed.get(download.showFolder);
      indexed.set(download.showFolder, {
        completed: (current?.completed ?? 0) + download.completed,
        size: (current?.size ?? 0) + download.size,
      });
    }
  }
  return indexed;
}

function ShowGridItem({ show, metadata, onSelect, downloads, watched }: {
  readonly show: ShowGroup;
  readonly metadata: ShowMetadata;
  readonly onSelect: (show: ShowGroup) => void;
  readonly downloads: ReadonlyMap<string, DownloadTotals>;
  readonly watched: boolean | ((show: ShowGroup) => boolean);
}): React.JSX.Element {
  const style = useMemo(() => ({
    viewTransitionName: showTransitionName(show.name),
  }), [show.name]);
  const downloadPercent = showDownloadPercent(show, downloads);
  return (
    <li style={style}>
      <ShowCard
        show={show}
        media={primaryShowMetadata(show, metadata)}
        onSelect={onSelect}
        downloadPercent={downloadPercent}
        watched={typeof watched === "function" ? watched(show) : watched}
      />
    </li>
  );
}

export function ShowGrid({
  shows,
  metadata,
  onSelect,
  downloads,
  watched = false,
}: ShowGridProps): React.JSX.Element {
  const [limit, setLimit] = useState(SHOW_BATCH_SIZE);
  const visible = shows.slice(0, limit);
  const indexedDownloads = useMemo(() => indexDownloads(downloads), [downloads]);
  const handleMore = useCallback(() => {
    setLimit((current) => current + SHOW_BATCH_SIZE);
  }, []);
  return (
    <>
      <ul className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
        {visible.map((show) => (
          <ShowGridItem
            key={show.name}
            show={show}
            metadata={metadata}
            onSelect={onSelect}
            downloads={indexedDownloads}
            watched={watched}
          />
        ))}
      </ul>
      {visible.length < shows.length && (
        <button
          type="button"
          onClick={handleMore}
          className="mx-auto mt-8 block rounded-md bg-secondary px-5 py-2.5 text-sm font-semibold text-secondary-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Show more ({String(shows.length - visible.length)} remaining)
        </button>
      )}
    </>
  );
}
