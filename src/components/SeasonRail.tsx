import { useCallback } from "react";
import { Check } from "lucide-react";
import type { AniListMedia, PlaybackProgressMap, ShowMetadata } from "../types.ts";
import { seasonMetadata, type SeasonGroup } from "../lib/library.ts";
import { seasonKey, seasonRailLabel, seasonWatchedRatio } from "../lib/seasonRail.ts";
import { cn } from "../lib/utils.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";

interface SeasonRailRowProps {
  readonly season: SeasonGroup;
  readonly media: AniListMedia | undefined;
  readonly showMedia: AniListMedia | undefined;
  readonly active: boolean;
  readonly ratio: number;
  readonly onSelect: (season: SeasonGroup) => void;
}

function SeasonRailRow({ season, media, showMedia, active, ratio, onSelect }: SeasonRailRowProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelect(season);
  }, [onSelect, season]);
  const label = seasonRailLabel(season, media, showMedia);
  const [first] = season.entries;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={handleClick}
      className={cn(
        "flex min-w-0 max-w-[16rem] shrink-0 items-center gap-3 rounded-xl p-2 pr-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-full lg:max-w-none lg:pr-2",
        active ? "bg-secondary" : "text-foreground/85 ring-1 ring-inset ring-border hover:text-foreground lg:ring-0",
      )}
    >
      {first !== undefined && (
        <MediaThumbnail rel={first.rel} source={media?.coverImage.large ?? media?.coverImage.extraLarge} art="cover" sizes="44px" className="aspect-[2/3] w-9 shrink-0 rounded-md lg:w-11" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[15px] font-bold tracking-tight lg:text-[17px]">{label.title}</span>
        {label.detail !== null && <span className="hidden truncate text-[13px] text-muted-foreground lg:block">{label.detail}</span>}
        {ratio > 0 && ratio < 1 && (
          <progress aria-label={`${label.title} watched`} max={1} value={ratio} className="playback-progress mt-1.5 hidden h-[3px] w-full overflow-hidden rounded-full lg:block" />
        )}
      </span>
      {ratio === 1 && <Check aria-label="Watched" className="hidden size-4 shrink-0 stroke-[3] text-primary lg:block" />}
    </button>
  );
}

interface SeasonRailProps {
  readonly seasons: readonly SeasonGroup[];
  readonly selected: SeasonGroup;
  readonly metadata: ShowMetadata;
  readonly progress: PlaybackProgressMap;
  readonly showMedia: AniListMedia | undefined;
  readonly onSelect: (season: SeasonGroup) => void;
}

/** A show's seasons: a rail beside the episodes, a swipe row above them on small screens. */
export function SeasonRail({ seasons, selected, metadata, progress, showMedia, onSelect }: SeasonRailProps): React.JSX.Element {
  return (
    <fieldset className="-mx-6 mb-6 flex min-w-0 gap-2 overflow-x-auto px-6 lg:sticky lg:top-[calc(var(--header-height)+1.5rem)] lg:mx-0 lg:mb-0 lg:flex-col lg:gap-1 lg:self-start lg:overflow-visible lg:px-0">
      <legend className="sr-only">Seasons</legend>
      {seasons.map((season) => (
        <SeasonRailRow
          key={seasonKey(season)}
          season={season}
          media={seasonMetadata(metadata, season.sourceShow, season.name)}
          showMedia={showMedia}
          active={season === selected}
          ratio={seasonWatchedRatio(season, progress)}
          onSelect={onSelect}
        />
      ))}
    </fieldset>
  );
}
