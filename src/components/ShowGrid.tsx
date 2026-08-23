import { useCallback, useMemo, useState } from "react";
import type { AniListMedia, ShowMetadata } from "../types.ts";
import { showMetadataKey, type ShowGroup } from "../lib/library.ts";
import { mediaTitle } from "../lib/anilist.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";

interface ShowCardProps {
  readonly show: ShowGroup;
  readonly media: AniListMedia | undefined;
  readonly onSelect: (show: ShowGroup) => void;
}

const SHOW_BATCH_SIZE = 120;

function ShowCard({ show, media, onSelect }: ShowCardProps): React.JSX.Element {
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
        className="group w-full overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {preview !== undefined && (
          <MediaThumbnail rel={preview.rel} source={cover} className="aspect-[2/3]" />
        )}
        <span className="block p-3">
          <span className="block truncate text-sm font-semibold">
            {media === undefined ? show.name : mediaTitle(media)}
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {show.seasons.length} {show.seasons.length === 1 ? "season" : "seasons"} ·{" "}
            {show.entries.length} {show.entries.length === 1 ? "episode" : "episodes"}
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
}

function showMedia(show: ShowGroup, metadata: ShowMetadata): AniListMedia | undefined {
  return metadata[showMetadataKey(show.name)];
}

function showTransitionName(name: string): string {
  let hash = 0;
  for (const character of name) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 2_147_483_647;
  }
  return `show-card-${hash.toString(36)}`;
}

function ShowGridItem({ show, metadata, onSelect }: {
  readonly show: ShowGroup;
  readonly metadata: ShowMetadata;
  readonly onSelect: (show: ShowGroup) => void;
}): React.JSX.Element {
  const style = useMemo(() => ({
    viewTransitionName: showTransitionName(show.name),
  }), [show.name]);
  return (
    <li style={style}>
      <ShowCard show={show} media={showMedia(show, metadata)} onSelect={onSelect} />
    </li>
  );
}

export function ShowGrid({ shows, metadata, onSelect }: ShowGridProps): React.JSX.Element {
  const [limit, setLimit] = useState(SHOW_BATCH_SIZE);
  const visible = shows.slice(0, limit);
  const handleMore = useCallback(() => {
    setLimit((current) => current + SHOW_BATCH_SIZE);
  }, []);
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {visible.map((show) => (
          <ShowGridItem key={show.name} show={show} metadata={metadata} onSelect={onSelect} />
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
