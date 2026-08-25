import { useCallback } from "react";
import { ExternalLink, Link } from "lucide-react";
import type {
  AniListMedia,
  MediaEntry,
  PlaybackProgressMap,
  ShowMetadata,
} from "../types.ts";
import aniListLogoUrl from "../assets/anilist-logo.svg";
import {
  isMovieMedia,
  seasonMetadata,
  seasonNumber,
  type SeasonGroup,
} from "../lib/library.ts";
import { mediaTitle } from "../lib/anilist.ts";
import { AniListListControls } from "./AniListListControls.tsx";
import { EpisodeGrid } from "./EpisodeGrid.tsx";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible.tsx";

interface SeasonSectionProps {
  readonly season: SeasonGroup;
  readonly media: AniListMedia | undefined;
  readonly defaultOpen: boolean;
  readonly progress: PlaybackProgressMap;
  readonly onEpisodeSelect: (entry: MediaEntry) => void;
  readonly onLink?: ((season: SeasonGroup) => void) | undefined;
  readonly showMedia: AniListMedia | undefined;
  readonly listMedia: AniListMedia | undefined;
}

function SeasonSection({
  season,
  media,
  defaultOpen,
  progress,
  onEpisodeSelect,
  onLink,
  showMedia,
  listMedia,
}: SeasonSectionProps): React.JSX.Element {
  const handleLink = useCallback(() => {
    onLink?.(season);
  }, [onLink, season]);
  const title = media === undefined ? season.name : mediaTitle(media);
  const number = seasonNumber(season, media);
  const movie = isMovieMedia(media);
  const providerName = media?.provider === "jikan" ? "MyAnimeList" : "AniList";

  return (
    <Collapsible defaultOpen={defaultOpen} asChild>
    <li className="border-b border-border pb-3 last:border-b-0">
      <div className="flex items-center py-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="w-7 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {movie ? "Film" : `S${String(number)}`}
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
          </button>
        </CollapsibleTrigger>
        {onLink !== undefined && (
          <button
            type="button"
            onClick={handleLink}
            aria-label={media === undefined ? `Match metadata for ${season.name}` : `Change match for ${title}`}
            title={media === undefined ? "Match metadata" : "Change metadata match"}
            className={`shrink-0 rounded p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${media === undefined ? "text-muted-foreground hover:text-primary" : "text-primary"}`}
          >
            <Link className="size-4" />
          </button>
        )}
        {media !== undefined && (
          <a
            href={media.siteUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`View ${title} on ${providerName}`}
            title={`View on ${providerName}`}
            className="inline-flex shrink-0 items-center gap-1 rounded p-2 text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {media.provider === "anilist"
              ? <img src={aniListLogoUrl} alt="" className="size-5" />
              : <span className="flex size-5 items-center justify-center rounded bg-primary text-xs font-bold text-primary-foreground">J</span>}
            <ExternalLink className="size-4" />
          </a>
        )}
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-label={`Expand or collapse ${title}`}
            className="shrink-0 rounded p-2 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CollapsibleChevron />
          </button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="pb-2 pl-8">
          {listMedia !== undefined && listMedia.anilistId !== null && (
            <AniListListControls media={listMedia} mediaId={listMedia.anilistId} />
          )}
          <EpisodeGrid
            entries={season.entries}
            media={media}
            progress={progress}
            onSelect={onEpisodeSelect}
            showMedia={showMedia}
            seasonNumber={number}
          />
        </div>
      </CollapsibleContent>
    </li>
    </Collapsible>
  );
}

interface SeasonListProps {
  readonly seasons: readonly SeasonGroup[];
  readonly metadata: ShowMetadata;
  readonly progress: PlaybackProgressMap;
  readonly onEpisodeSelect: (entry: MediaEntry) => void;
  readonly onLink?: ((season: SeasonGroup) => void) | undefined;
  readonly showMedia: AniListMedia | undefined;
}

export function SeasonList({
  seasons,
  metadata,
  progress,
  onEpisodeSelect,
  onLink,
  showMedia,
}: SeasonListProps): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-3">
      {seasons.map((season, index) => {
        const media = seasonMetadata(metadata, season.sourceShow, season.name);
        return (
          <SeasonSection
            key={`${season.sourceShow}/${season.name}`}
            season={season}
            media={media}
            defaultOpen={index === 0}
            progress={progress}
            onEpisodeSelect={onEpisodeSelect}
            onLink={onLink}
            showMedia={showMedia}
            listMedia={media ?? (seasons.length === 1 ? showMedia : undefined)}
          />
        );
      })}
    </ul>
  );
}
