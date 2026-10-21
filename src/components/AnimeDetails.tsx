import { useCallback, useState } from "react";
import { ExternalLink, Link } from "lucide-react";
import type { AniListMedia } from "../types.ts";
import { mediaTitle } from "../lib/anilist.ts";
import { Badge } from "./ui/badge.tsx";
import { MediaThumbnail } from "./MediaThumbnail.tsx";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible.tsx";

interface AnimeDetailsProps {
  readonly fallbackTitle: string;
  readonly previewRel: string;
  readonly media: AniListMedia | undefined;
  readonly onLink?: (() => void) | undefined;
}

const YEAR_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  timeZone: "UTC",
});
const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  timeZone: "UTC",
});
const DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function airDateFormatter(month: number | null, day: number | null): Intl.DateTimeFormat {
  if (month === null) {
    return YEAR_FORMATTER;
  }
  return day === null ? MONTH_FORMATTER : DAY_FORMATTER;
}

function MediaFacts({ media }: { readonly media: AniListMedia }): React.JSX.Element {
  const aired = media.startDate?.year === null || media.startDate === null
    ? null
    : airDateFormatter(media.startDate.month, media.startDate.day).format(new Date(
        `${String(media.startDate.year).padStart(4, "0")}-${String(media.startDate.month ?? 1).padStart(2, "0")}-${String(media.startDate.day ?? 1).padStart(2, "0")}T00:00:00Z`,
      ));
  const facts = [
    aired ?? (media.season && media.seasonYear
      ? `${media.season.toLowerCase()} ${String(media.seasonYear)}`
      : null),
    media.format?.toLocaleUpperCase() === "MOVIE" || media.episodes === null
      ? null
      : `${String(media.episodes)} episodes`,
    media.duration === null ? null : `${String(media.duration)} min`,
    media.averageScore === null ? null : `${String(media.averageScore)}% score`,
  ].filter((fact) => fact !== null);
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {facts.map((fact) => <Badge key={fact} variant="secondary">{fact}</Badge>)}
      {media.genres.slice(0, 3).map((genre) => (
        <Badge key={genre} variant="outline">{genre}</Badge>
      ))}
    </div>
  );
}

function AnimeMetadata({ media, expanded }: {
  readonly media: AniListMedia;
  readonly expanded: boolean;
}): React.JSX.Element {
  const canExpand = media.genres.length > 3 || (media.description?.length ?? 0) > 240;
  return (
    <>
      {media.title.english !== media.title.romaji && <p className="mt-1 text-sm text-muted-foreground">{media.title.romaji}</p>}
      <MediaFacts media={media} />
      <CollapsibleContent><div className="mt-2 flex flex-wrap gap-2">{media.genres.slice(3).map((genre) => <Badge key={genre} variant="outline">{genre}</Badge>)}</div></CollapsibleContent>
      {media.description !== null && <p className="anime-description mt-4 whitespace-pre-line text-sm leading-6 text-muted-foreground">{media.description}</p>}
      {canExpand && (
        <CollapsibleTrigger asChild>
          <button type="button" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {expanded ? "Show less" : "Show more"}<CollapsibleChevron className="size-4" />
          </button>
        </CollapsibleTrigger>
      )}
      <a href={media.siteUrl} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-1.5 text-sm text-primary hover:underline">
        View on AniList<ExternalLink className="size-3.5" />
      </a>
    </>
  );
}

function DetailsTitle({ media, fallbackTitle }: {
  readonly media: AniListMedia | undefined;
  readonly fallbackTitle: string;
}): React.JSX.Element {
  return <h2 className="min-w-0 text-xl font-semibold">{media === undefined ? fallbackTitle : mediaTitle(media)}</h2>;
}

export function AnimeDetails({
  fallbackTitle,
  previewRel,
  media,
  onLink,
}: AnimeDetailsProps): React.JSX.Element {
  const [expanded, setExpanded] = useState<boolean>(false);
  const handleLink = useCallback(() => {
    onLink?.();
  }, [onLink]);
  const cover = media?.coverImage.extraLarge ?? media?.coverImage.large;

  return (
    <aside>
      <MediaThumbnail rel={previewRel} source={cover} art="cover" sizes="240px" className="aspect-[2/3] w-full" />
      <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
      <div className="pt-3">
        <div className="flex items-start gap-2">
          {onLink !== undefined && (
            <button
              type="button"
              onClick={handleLink}
              aria-label={media === undefined ? "Match show metadata" : "Change metadata match"}
              title={media === undefined ? "Match metadata" : "Change metadata match"}
              className="mt-0.5 shrink-0 rounded p-1 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Link className="size-4" />
            </button>
          )}
          <DetailsTitle media={media} fallbackTitle={fallbackTitle} />
        </div>
        {media !== undefined && <AnimeMetadata media={media} expanded={expanded} />}
      </div>
      </Collapsible>
    </aside>
  );
}
