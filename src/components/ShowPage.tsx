import { ArrowLeft } from "lucide-react";
import type {
  AniListMedia,
  MediaEntry,
  PlaybackProgressMap,
  ShowMetadata,
} from "../types.ts";
import type { SeasonGroup, ShowGroup } from "../lib/library.ts";
import { AnimeDetails } from "./AnimeDetails.tsx";
import { SeasonList } from "./SeasonList.tsx";

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
  return (
    <section>
      <button
        type="button"
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" />
        All shows
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
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Seasons</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {show.seasons.length} {show.seasons.length === 1 ? "season" : "seasons"}
              </p>
            </div>
          </div>
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
