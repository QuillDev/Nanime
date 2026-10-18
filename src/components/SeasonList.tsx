import type {
  AniListMedia,
  MediaEntry,
  PlaybackProgressMap,
  ShowMetadata,
} from "../types.ts";
import {
  isMovieMedia,
  seasonMetadata,
  seasonNumber,
  type SeasonGroup,
} from "../lib/library.ts";
import { mediaTitle } from "../lib/anilist.ts";
import { AniListListControls } from "./AniListListControls.tsx";
import { EpisodeGrid } from "./EpisodeGrid.tsx";
import { SeasonActionsMenu } from "./SeasonActionsMenu.tsx";
import { SeasonTranscodeStatus } from "./SeasonTranscodeStatus.tsx";
import { useSeasonReadiness } from "../hooks/usePlaybackReadiness.ts";
import { summarizeSeasonTranscode } from "../lib/seasonTranscode.ts";
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
  readonly heading: string;
  readonly canTranscode: boolean;
}

function useSeasonTranscode(season: SeasonGroup) {
  const streamed = season.entries.flatMap((entry) => (entry.direct ? [] : [entry.rel]));
  const readiness = useSeasonReadiness(streamed);
  return summarizeSeasonTranscode(streamed, season.entries.length, readiness.data);
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
  heading,
  canTranscode,
}: SeasonSectionProps): React.JSX.Element {
  const transcode = useSeasonTranscode(season);
  const title = media === undefined ? season.name : mediaTitle(media);
  const number = seasonNumber(season, media);

  return (
    <Collapsible defaultOpen={defaultOpen} asChild>
    <li className="pb-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pb-5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <h2 className="truncate font-display text-2xl font-bold tracking-tight">{heading === "" ? title : heading}</h2>
            <CollapsibleChevron className="size-5 text-muted-foreground" />
          </button>
        </CollapsibleTrigger>
        <SeasonTranscodeStatus summary={transcode} canTranscode={canTranscode} />
        {transcode.kind === "ready" && <span className="flex-1" />}
        <SeasonActionsMenu
          media={media}
          playbackMedia={listMedia}
          progress={progress}
          season={season}
          title={title}
          onLink={onLink}
        />
      </div>
      <CollapsibleContent>
        <div>
          {listMedia !== undefined && listMedia.anilistId !== null && (
            <AniListListControls media={listMedia} mediaId={listMedia.anilistId} />
          )}
          <EpisodeGrid
            entries={season.entries}
            media={listMedia}
            progress={progress}
            onSelect={onEpisodeSelect}
            showMedia={showMedia}
            seasonNumber={number}
            transcode={transcode}
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
  readonly canTranscode: boolean;
}

/** One season reads as "Episodes" under the show hero; several keep their own names. */
function seasonHeading(seasons: readonly SeasonGroup[], season: SeasonGroup, media: AniListMedia | undefined): string {
  if (seasons.length === 1 && !isMovieMedia(media)) {
    return "Episodes";
  }
  return media === undefined ? `Season ${String(seasonNumber(season, media))}` : "";
}

export function SeasonList({
  seasons,
  metadata,
  progress,
  onEpisodeSelect,
  onLink,
  showMedia,
  canTranscode,
}: SeasonListProps): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-4">
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
            heading={seasonHeading(seasons, season, media)}
            canTranscode={canTranscode}
          />
        );
      })}
    </ul>
  );
}
