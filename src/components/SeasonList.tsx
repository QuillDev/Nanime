import { useCallback, useState } from "react";
import type { AniListMedia, MediaEntry, PlaybackProgressMap, ShowMetadata } from "../types.ts";
import { isMovieMedia, seasonMetadata, statedSeasonNumber, type SeasonGroup } from "../lib/library.ts";
import { currentSeason, seasonKey } from "../lib/seasonRail.ts";
import { SeasonRail } from "./SeasonRail.tsx";
import { SeasonSection } from "./SeasonSection.tsx";

interface SeasonListProps {
  readonly seasons: readonly SeasonGroup[];
  readonly metadata: ShowMetadata;
  readonly progress: PlaybackProgressMap;
  readonly onEpisodeSelect: (entry: MediaEntry) => void;
  readonly onLink?: ((season: SeasonGroup) => void) | undefined;
  readonly showMedia: AniListMedia | undefined;
  readonly canTranscode: boolean;
}

/** One season reads as "Episodes" under the show hero; several go by their own title, or "Season 2" when unmatched but numbered. */
function seasonHeading(seasons: readonly SeasonGroup[], season: SeasonGroup, media: AniListMedia | undefined): string {
  if (seasons.length === 1 && !isMovieMedia(media)) {
    return "Episodes";
  }
  const number = media === undefined ? statedSeasonNumber(season, media) : undefined;
  return number === undefined ? "" : `Season ${String(number)}`;
}

/** One season at a time: the one being watched until another is picked from the rail. */
export function SeasonList({
  seasons,
  metadata,
  progress,
  onEpisodeSelect,
  onLink,
  showMedia,
  canTranscode,
}: SeasonListProps): React.JSX.Element | null {
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const handleSelect = useCallback((season: SeasonGroup) => {
    setPickedKey(seasonKey(season));
  }, []);
  const season = seasons.find((candidate) => seasonKey(candidate) === pickedKey) ?? currentSeason(seasons, progress);
  if (season === undefined) {
    return null;
  }
  const media = seasonMetadata(metadata, season.sourceShow, season.name);
  const section = (
    <SeasonSection
      key={seasonKey(season)}
      season={season}
      media={media}
      progress={progress}
      onEpisodeSelect={onEpisodeSelect}
      onLink={onLink}
      showMedia={showMedia}
      listMedia={media ?? (seasons.length === 1 ? showMedia : undefined)}
      heading={seasonHeading(seasons, season, media)}
      canTranscode={canTranscode}
    />
  );
  if (seasons.length === 1) {
    return section;
  }
  return (
    <div className="lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:gap-10">
      <SeasonRail seasons={seasons} selected={season} metadata={metadata} progress={progress} showMedia={showMedia} onSelect={handleSelect} />
      {section}
    </div>
  );
}
