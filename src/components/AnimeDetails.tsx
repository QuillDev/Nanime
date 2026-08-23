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

function MediaFacts({ media }: { readonly media: AniListMedia }): React.JSX.Element {
  const facts = [
    media.season && media.seasonYear
      ? `${media.season.toLowerCase()} ${String(media.seasonYear)}`
      : null,
    media.episodes === null ? null : `${String(media.episodes)} episodes`,
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
  const canExpand = media !== undefined && (
    media.genres.length > 3 || (media.description?.length ?? 0) > 240
  );

  return (
    <aside className="overflow-hidden rounded-xl border border-border bg-card">
      <MediaThumbnail rel={previewRel} source={cover} className="aspect-[2/3] w-full" />
      <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
      <div className="p-5">
        <div className="flex items-start gap-2">
          {onLink !== undefined && (
            <button
              type="button"
              onClick={handleLink}
              aria-label={media === undefined ? "Link show with AniList" : "Change AniList match"}
              title={media === undefined ? "Link show with AniList" : "Change AniList match"}
              className="mt-0.5 shrink-0 rounded p-1 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Link className="size-4" />
            </button>
          )}
          <h2 className="min-w-0 text-xl font-semibold">
            {media === undefined ? fallbackTitle : mediaTitle(media)}
          </h2>
        </div>
        {media !== undefined && media.title.english !== media.title.romaji && (
          <p className="mt-1 text-sm text-muted-foreground">{media.title.romaji}</p>
        )}
        {media !== undefined && <MediaFacts media={media} />}
        <CollapsibleContent>
          <div className="mt-2 flex flex-wrap gap-2">
            {media?.genres.slice(3).map((genre) => (
              <Badge key={genre} variant="outline">{genre}</Badge>
            ))}
          </div>
        </CollapsibleContent>
        {media?.description !== null && media?.description !== undefined && (
          <p className="anime-description mt-4 whitespace-pre-line text-sm leading-6 text-muted-foreground">
            {media.description}
          </p>
        )}
        {canExpand && (
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {expanded ? "Show less" : "Show more"}
              <CollapsibleChevron className="size-4" />
            </button>
          </CollapsibleTrigger>
        )}
        {media !== undefined && (
          <a
            href={media.siteUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            View on AniList
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
      </Collapsible>
    </aside>
  );
}
