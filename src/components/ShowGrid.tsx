import { useCallback, useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { AniListMedia, ShowMetadata, TorrentStatus } from "../types.ts";
import {
  primaryShowMetadata,
  type ShowGroup,
} from "../lib/library.ts";
import { mediaTitle } from "../lib/anilist.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";

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
  const [preview] = show.entries;
  const cover = media?.coverImage.large ?? media?.coverImage.extraLarge;

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className="group w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="relative block">
          {preview !== undefined && (
            <MediaThumbnail rel={preview.rel} source={cover} watched={watched} className="aspect-[2/3]" />
          )}
          {downloadPercent !== null && (
            <span className="absolute inset-x-2 bottom-2 rounded-md bg-black p-2 text-xs font-semibold text-foreground">
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
        <span className="block pt-1">
          <span className="block truncate text-sm font-semibold">
            {media === undefined ? show.name : mediaTitle(media)}
          </span>
        </span>
      </button>
    </div>
  );
}

interface ShowGridProps {
  readonly shows: readonly ShowGroup[];
  readonly metadata: ShowMetadata;
  readonly onSelect: (show: ShowGroup) => void;
  readonly downloads: readonly TorrentStatus[];
  readonly watched?: boolean;
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

function indexDownloads(downloads: readonly TorrentStatus[]): ReadonlyMap<string, DownloadTotals> {
  const indexed = new Map<string, DownloadTotals>();
  for (const torrent of downloads) {
    if (torrent.showFolder !== null) {
      const current = indexed.get(torrent.showFolder);
      indexed.set(torrent.showFolder, {
        completed: (current?.completed ?? 0) + torrent.completed,
        size: (current?.size ?? 0) + torrent.size,
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
  readonly watched: boolean;
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
        watched={watched}
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
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
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
