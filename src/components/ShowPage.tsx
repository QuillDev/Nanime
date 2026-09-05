import { ArrowLeft } from "lucide-react";
import type {
  AniListMedia,
  MediaEntry,
  PlaybackProgressMap,
  ShowMetadata,
} from "../types.ts";
import {
  isMovieMedia,
  seasonMetadata,
  type SeasonGroup,
  type ShowGroup,
} from "../lib/library.ts";
import { AnimeDetails } from "./AnimeDetails.tsx";
import { SeasonList } from "./SeasonList.tsx";
import { ShelfHeading } from "./ShelfHeading.tsx";

interface ShowPageProps {
  readonly show: ShowGroup;
  readonly media: AniListMedia | undefined;
  readonly metadata: ShowMetadata;
  readonly progress: PlaybackProgressMap;
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
  onBack,
  onShowLink,
  onSeasonLink,
  onEpisodeSelect,
}: ShowPageProps): React.JSX.Element {
  const [preview] = show.entries;
  const movieCount = show.seasons.filter((season) => (
    isMovieMedia(seasonMetadata(metadata, season.sourceShow, season.name))
  )).length;
  const seasonCount = show.seasons.length - movieCount;
  const sectionTitle = movieCount > 0 ? "Seasons & movies" : "Seasons";
  const sectionCount = seasonCount + movieCount;
  return (
    <section>
      <button
        type="button"
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" />
        All titles
      </button>
      <div className="grid items-start gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {preview !== undefined && (
          <AnimeDetails
            fallbackTitle={show.name}
            previewRel={preview.rel}
            media={media}
            onLink={onShowLink}
          />
        )}
        <div className="min-w-0">
          <ShelfHeading
            count={sectionCount}
            title={sectionTitle}
            singularLabel="season or movie"
            pluralLabel="seasons and movies"
          />
          <SeasonList
            seasons={show.seasons}
            metadata={metadata}
            progress={progress}
            onEpisodeSelect={onEpisodeSelect}
            onLink={onSeasonLink}
            showMedia={media}
          />
        </div>
      </div>
    </section>
  );
}
