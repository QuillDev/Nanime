import { useCallback } from "react";
import { Trash2 } from "lucide-react";
import type {
  AniListMedia,
  MediaEntry,
  PlaybackProgressMap,
} from "../types.ts";
import { formatSize } from "../api.ts";
import { episodeMetadata, episodeNumber } from "../lib/anilist.ts";
import { Badge } from "./ui/badge.tsx";
import { MediaThumbnail } from "./MediaThumbnail.tsx";
import { PlaybackStatus } from "./PlaybackStatus.tsx";

interface EpisodeCardProps {
  readonly entry: MediaEntry;
  readonly media: AniListMedia | undefined;
  readonly progress: PlaybackProgressMap;
  readonly onSelect: (entry: MediaEntry) => void;
  readonly onDelete?: ((entry: MediaEntry) => void) | undefined;
  readonly showMedia: AniListMedia | undefined;
  readonly seasonNumber: number;
}

function EpisodeCard({
  entry,
  media,
  progress,
  onSelect,
  onDelete,
  showMedia,
  seasonNumber,
}: EpisodeCardProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelect(entry);
  }, [entry, onSelect]);
  const handleDelete = useCallback(() => {
    onDelete?.(entry);
  }, [entry, onDelete]);
  const details = episodeMetadata(entry, media, { showMedia, season: seasonNumber });
  const number = episodeNumber(entry);

  return (
    <li className="flex overflow-hidden rounded-lg border border-border bg-card transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-primary">
      <button
        type="button"
        onClick={handleClick}
        className="group flex min-w-0 flex-1 text-left focus-visible:outline-none"
      >
        <MediaThumbnail
          rel={entry.rel}
          source={details?.thumbnail}
          className="w-32 shrink-0 self-stretch sm:w-44"
        />
        <span className="flex min-w-0 flex-1 flex-col justify-center p-4">
          <span className="flex min-w-0 items-start gap-3">
            {number !== null && (
              <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
                {String(number).padStart(2, "0")}
              </span>
            )}
            <span className="line-clamp-2 font-medium" title={entry.name}>
              {details?.title ?? entry.name}
            </span>
          </span>
          <span className="mt-2 flex items-center gap-2">
            {!entry.direct && <Badge variant="outline">transcode</Badge>}
            <span className="text-sm text-muted-foreground">{formatSize(entry.size)}</span>
            {details?.airDate !== null && details?.airDate !== undefined && (
              <span className="text-sm text-muted-foreground">{details.airDate}</span>
            )}
          </span>
          <PlaybackStatus progress={progress[entry.rel]} />
        </span>
      </button>
      {onDelete !== undefined && (
        <button
          type="button"
          onClick={handleDelete}
          aria-label={`Delete ${details?.title ?? entry.name}`}
          title="Delete episode"
          className="shrink-0 self-stretch px-3 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </li>
  );
}

interface EpisodeGridProps {
  readonly entries: readonly MediaEntry[];
  readonly media: AniListMedia | undefined;
  readonly progress: PlaybackProgressMap;
  readonly onSelect: (entry: MediaEntry) => void;
  readonly onDelete?: ((entry: MediaEntry) => void) | undefined;
  readonly showMedia: AniListMedia | undefined;
  readonly seasonNumber: number;
}

export function EpisodeGrid({
  entries,
  media,
  progress,
  onSelect,
  onDelete,
  showMedia,
  seasonNumber,
}: EpisodeGridProps): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <EpisodeCard
          key={entry.rel}
          entry={entry}
          media={media}
          progress={progress}
          onSelect={onSelect}
          onDelete={onDelete}
          showMedia={showMedia}
          seasonNumber={seasonNumber}
        />
      ))}
    </ul>
  );
}
