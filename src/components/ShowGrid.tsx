import { useCallback } from "react";
import type { AniListMedia, ShowMetadata } from "../types.ts";
import { showMetadataKey, type ShowGroup } from "../lib/library.ts";
import { mediaTitle } from "../lib/anilist.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";

interface ShowCardProps {
  readonly show: ShowGroup;
  readonly media: AniListMedia | undefined;
  readonly onSelect: (show: ShowGroup) => void;
}

function ShowCard({ show, media, onSelect }: ShowCardProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelect(show);
  }, [onSelect, show]);
  const [preview] = show.entries;
  const cover = media?.coverImage.extraLarge ?? media?.coverImage.large;

  return (
    <li>
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
    </li>
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

export function ShowGrid({ shows, metadata, onSelect }: ShowGridProps): React.JSX.Element {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {shows.map((show) => (
        <ShowCard
          key={show.name}
          show={show}
          media={showMedia(show, metadata)}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}
