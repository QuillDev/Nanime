import { useCallback, useState } from "react";
import { ChevronDown, Link, Trash2 } from "lucide-react";
import type {
  AniListMedia,
  MediaEntry,
  PlaybackProgressMap,
  ShowMetadata,
} from "../types.ts";
import { seasonMetadata, seasonNumber, type SeasonGroup } from "../lib/library.ts";
import { mediaTitle } from "../lib/anilist.ts";
import { EpisodeGrid } from "./EpisodeGrid.tsx";

interface SeasonSectionProps {
  readonly season: SeasonGroup;
  readonly media: AniListMedia | undefined;
  readonly defaultOpen: boolean;
  readonly progress: PlaybackProgressMap;
  readonly onEpisodeSelect: (entry: MediaEntry) => void;
  readonly onLink: (season: SeasonGroup) => void;
  readonly onSeasonDelete?: ((season: SeasonGroup) => void) | undefined;
  readonly onEpisodeDelete?: ((entry: MediaEntry) => void) | undefined;
  readonly showMedia: AniListMedia | undefined;
}

function SeasonSection({
  season,
  media,
  defaultOpen,
  progress,
  onEpisodeSelect,
  onLink,
  onSeasonDelete,
  onEpisodeDelete,
  showMedia,
}: SeasonSectionProps): React.JSX.Element {
  const [open, setOpen] = useState<boolean>(defaultOpen);
  const handleToggle = useCallback(() => {
    setOpen((current) => !current);
  }, []);
  const handleLink = useCallback(() => {
    onLink(season);
  }, [onLink, season]);
  const handleDelete = useCallback(() => {
    onSeasonDelete?.(season);
  }, [onSeasonDelete, season]);
  const title = media === undefined ? season.name : mediaTitle(media);
  const number = seasonNumber(season, media);

  return (
    <li className="border-b border-border pb-3 last:border-b-0">
      <div className="flex items-center py-2">
        <button
          type="button"
          onClick={handleLink}
          aria-label={media === undefined ? `Link ${season.name} with AniList` : `Change match for ${title}`}
          title={media === undefined ? "Link with AniList" : "Change AniList match"}
          className={`mr-2 shrink-0 rounded p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${media === undefined ? "text-muted-foreground hover:text-primary" : "text-primary"}`}
        >
          <Link className="size-4" />
        </button>
        <button
          type="button"
          aria-expanded={open}
          onClick={handleToggle}
          className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="w-7 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            S{String(number)}
          </span>
          <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
          <ChevronDown
            className={`size-5 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </button>
        {onSeasonDelete !== undefined && (
          <button
            type="button"
            onClick={handleDelete}
            aria-label={`Delete ${title}`}
            title="Delete season"
            className="shrink-0 rounded p-2 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
      {open && (
        <div className="pb-2 pl-8">
          <EpisodeGrid
            entries={season.entries}
            media={media}
            progress={progress}
            onSelect={onEpisodeSelect}
            onDelete={onEpisodeDelete}
            showMedia={showMedia}
            seasonNumber={number}
          />
        </div>
      )}
    </li>
  );
}

interface SeasonListProps {
  readonly seasons: readonly SeasonGroup[];
  readonly metadata: ShowMetadata;
  readonly progress: PlaybackProgressMap;
  readonly onEpisodeSelect: (entry: MediaEntry) => void;
  readonly onLink: (season: SeasonGroup) => void;
  readonly onSeasonDelete?: ((season: SeasonGroup) => void) | undefined;
  readonly onEpisodeDelete?: ((entry: MediaEntry) => void) | undefined;
  readonly showMedia: AniListMedia | undefined;
}

export function SeasonList({
  seasons,
  metadata,
  progress,
  onEpisodeSelect,
  onLink,
  onSeasonDelete,
  onEpisodeDelete,
  showMedia,
}: SeasonListProps): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-3">
      {seasons.map((season, index) => (
        <SeasonSection
          key={`${season.sourceShow}/${season.name}`}
          season={season}
          media={seasonMetadata(metadata, season.sourceShow, season.name)}
          defaultOpen={index === 0}
          progress={progress}
          onEpisodeSelect={onEpisodeSelect}
          onLink={onLink}
          onSeasonDelete={onSeasonDelete}
          onEpisodeDelete={onEpisodeDelete}
          showMedia={showMedia}
        />
      ))}
    </ul>
  );
}
