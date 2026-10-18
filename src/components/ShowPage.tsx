import type {
  AniListMedia,
  MediaEntry,
  PlaybackProgressMap,
  ShowMetadata,
} from "../types.ts";
import type { SeasonGroup, ShowGroup } from "../lib/library.ts";
import { SeasonList } from "./SeasonList.tsx";
import { ShowHero } from "./ShowHero.tsx";

interface ShowPageProps {
  readonly show: ShowGroup;
  readonly media: AniListMedia | undefined;
  readonly metadata: ShowMetadata;
  readonly progress: PlaybackProgressMap;
  readonly canTranscode: boolean;
  readonly onBack: () => void;
  readonly onShowLink?: (() => void) | undefined;
  readonly onSeasonLink?: ((season: SeasonGroup) => void) | undefined;
  readonly onEpisodeSelect: (entry: MediaEntry) => void;
}

export function ShowPage({
  show,
  media,
  metadata,
  progress,
  canTranscode,
  onBack,
  onShowLink,
  onSeasonLink,
  onEpisodeSelect,
}: ShowPageProps): React.JSX.Element {
  return (
    <div>
      <ShowHero
        show={show}
        media={media}
        progress={progress}
        onBack={onBack}
        onLink={onShowLink}
        onPlay={onEpisodeSelect}
      />
      <SeasonList
        seasons={show.seasons}
        metadata={metadata}
        progress={progress}
        onEpisodeSelect={onEpisodeSelect}
        onLink={onSeasonLink}
        showMedia={media}
        canTranscode={canTranscode}
      />
    </div>
  );
}
