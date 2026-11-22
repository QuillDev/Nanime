import type { AniListMedia, MediaEntry, PlaybackProgressMap } from "../types.ts";
import { seasonDisplayName, seasonNumber, type SeasonGroup } from "../lib/library.ts";
import { mediaTitle } from "../lib/anilist.ts";
import { AniListListControls } from "./AniListListControls.tsx";
import { EpisodeList } from "./EpisodeList.tsx";
import { SeasonActionsMenu } from "./SeasonActionsMenu.tsx";
import { SeasonTranscodeStatus } from "./SeasonTranscodeStatus.tsx";
import { streamedSeasonPaths, useSeasonReadiness } from "../hooks/usePlaybackReadiness.ts";
import { summarizeSeasonTranscode } from "../lib/seasonTranscode.ts";

interface SeasonSectionProps {
  readonly season: SeasonGroup;
  readonly media: AniListMedia | undefined;
  readonly progress: PlaybackProgressMap;
  readonly onEpisodeSelect: (entry: MediaEntry) => void;
  readonly onLink?: ((season: SeasonGroup) => void) | undefined;
  readonly showMedia: AniListMedia | undefined;
  readonly listMedia: AniListMedia | undefined;
  readonly heading: string;
  readonly canTranscode: boolean;
}

function useSeasonTranscode(season: SeasonGroup) {
  const streamed = streamedSeasonPaths(season.entries);
  const readiness = useSeasonReadiness(streamed);
  return summarizeSeasonTranscode(streamed, season.entries.length, readiness.data);
}

/** One season: its heading, actions and episodes. */
export function SeasonSection({
  season,
  media,
  progress,
  onEpisodeSelect,
  onLink,
  showMedia,
  listMedia,
  heading,
  canTranscode,
}: SeasonSectionProps): React.JSX.Element {
  const transcode = useSeasonTranscode(season);
  const title = media === undefined ? seasonDisplayName(season) : mediaTitle(media);
  const number = seasonNumber(season, media);

  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pb-4">
        <h2 className="min-w-0 max-w-[calc(100%-4.25rem)] truncate font-display text-2xl font-bold tracking-tight">{heading === "" ? title : heading}</h2>
        <SeasonTranscodeStatus summary={transcode} canTranscode={canTranscode} />
        {transcode.kind === "ready" && <span className="flex-1" />}
        <SeasonActionsMenu
          media={media}
          playbackMedia={listMedia}
          progress={progress}
          season={season}
          title={title}
          onLink={onLink}
          canRename={canTranscode}
          showMedia={showMedia}
          seasonNumber={number}
        />
      </div>
      {listMedia !== undefined && listMedia.anilistId !== null && (
        <AniListListControls media={listMedia} mediaId={listMedia.anilistId} />
      )}
      <EpisodeList
        entries={season.entries}
        media={listMedia}
        progress={progress}
        onSelect={onEpisodeSelect}
        transcode={transcode}
        canRename={canTranscode}
      />
    </section>
  );
}
