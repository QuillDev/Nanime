import { useCallback, useState } from "react";
import { ArrowLeft, ExternalLink, Link, Play } from "lucide-react";
import type { AniListMedia, MediaEntry, PlaybackProgressMap } from "../types.ts";
import type { ShowGroup } from "../lib/library.ts";
import { episodeNumber, mediaTitle } from "../lib/anilist.ts";
import { thumbnailUrl } from "../api.ts";
import { cn } from "../lib/utils.ts";

interface ShowHeroProps {
  readonly show: ShowGroup;
  readonly media: AniListMedia | undefined;
  readonly progress: PlaybackProgressMap;
  readonly onBack: () => void;
  readonly onLink?: (() => void) | undefined;
  readonly onPlay: (entry: MediaEntry) => void;
}

interface NextEpisode {
  readonly entry: MediaEntry;
  readonly label: string;
}

/** The first unfinished episode in library order; resuming one already started. */
function nextEpisode(show: ShowGroup, progress: PlaybackProgressMap): NextEpisode | null {
  const entries = show.seasons.flatMap((season) => season.entries);
  const next = entries.find((entry) => progress[entry.rel]?.completed !== true);
  const entry = next ?? entries[0];
  if (entry === undefined) {
    return null;
  }
  const number = episodeNumber(entry);
  const name = number === null ? "" : ` episode ${String(number)}`;
  if (next === undefined) {
    return { entry, label: `Watch again from${name || " the start"}` };
  }
  return { entry, label: progress[entry.rel] === undefined ? `Play${name}` : `Continue${name}` };
}

function kickerFacts(show: ShowGroup, media: AniListMedia | undefined): readonly string[] {
  const seasons = show.seasons.length;
  return [
    seasons === 1 ? null : `${String(seasons)} seasons`,
    media?.seasonYear === null || media?.seasonYear === undefined ? null : String(media.seasonYear),
    `${String(show.entries.length)} episodes`,
    media?.averageScore === null || media?.averageScore === undefined ? null : `${String(media.averageScore)}% score`,
  ].filter((fact) => fact !== null);
}

function HeroDescription({ text }: { readonly text: string }): React.JSX.Element {
  const [expanded, setExpanded] = useState<boolean>(false);
  const handleToggle = useCallback(() => {
    setExpanded((value) => !value);
  }, []);
  return (
    <div className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
      <p className={cn("anime-description whitespace-pre-line", !expanded && "line-clamp-2")}>{text}</p>
      <button type="button" onClick={handleToggle} className="mt-1 font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {expanded ? "Less" : "More"}
      </button>
    </div>
  );
}

function HeroBackdrop({ show, media }: { readonly show: ShowGroup; readonly media: AniListMedia | undefined }): React.JSX.Element {
  const banner = media?.bannerImage ?? null;
  const cover = media?.coverImage.extraLarge ?? media?.coverImage.large ?? null;
  const fallback = show.entries[0] === undefined ? null : thumbnailUrl(show.entries[0].rel);
  const source = banner ?? cover ?? fallback;
  return (
    <>
      {source !== null && (
        <img
          src={source}
          alt=""
          className={cn("absolute inset-0 size-full object-cover object-[50%_30%]", banner === null && "scale-110 blur-md")}
        />
      )}
      <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(90deg,rgb(0_0_0/0.96)_0%,rgb(0_0_0/0.78)_42%,rgb(0_0_0/0.15)_80%),linear-gradient(0deg,rgb(0_0_0)_0%,transparent_55%)]" />
    </>
  );
}

interface HeroText {
  readonly title: string;
  readonly romaji: string | null;
  readonly genres: readonly string[];
  readonly description: string | null;
}

function heroText(show: ShowGroup, media: AniListMedia | undefined): HeroText {
  if (media === undefined) {
    return { title: show.name, romaji: null, genres: [], description: null };
  }
  return {
    title: mediaTitle(media),
    romaji: media.title.romaji === media.title.english ? null : media.title.romaji,
    genres: media.genres.slice(0, 5),
    description: media.description,
  };
}

export function ShowHero({ show, media, progress, onBack, onLink, onPlay }: ShowHeroProps): React.JSX.Element {
  const next = nextEpisode(show, progress);
  const handlePlay = useCallback(() => {
    if (next !== null) {
      onPlay(next.entry);
    }
  }, [next, onPlay]);
  const { title, romaji, genres, description } = heroText(show, media);
  const linkLabel = media === undefined ? "Match show metadata" : "Change metadata match";
  return (
    <section className="relative mx-[calc(50%-50vw)] -mt-6 mb-8 flex min-h-[420px] items-end overflow-hidden">
      <HeroBackdrop show={show} media={media} />
      <div className="relative mx-auto w-full max-w-7xl px-6 pb-8 pt-16">
        <button type="button" onClick={onBack} className="absolute left-6 top-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="size-4" />
          All titles
        </button>
        <p className="flex flex-wrap gap-x-2 text-[15px] text-muted-foreground">
          {kickerFacts(show, media).map((fact, index) => (
            <span key={fact}>{index > 0 && <span aria-hidden="true" className="mr-2 text-muted-foreground/50">·</span>}{fact}</span>
          ))}
        </p>
        <div className="mt-2 flex max-w-3xl items-start gap-3">
          <h1 className="font-display text-4xl font-extrabold leading-[0.98] tracking-[-0.04em] text-balance sm:text-6xl">{title}</h1>
          {onLink !== undefined && (
            <button type="button" onClick={onLink} aria-label={linkLabel} title={linkLabel} className="mt-2 shrink-0 rounded-full p-2 text-muted-foreground hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Link className="size-4" />
            </button>
          )}
        </div>
        {romaji !== null && <p className="mt-2 text-sm text-muted-foreground">{romaji}</p>}
        {genres.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2 text-[13px] text-muted-foreground">
            {genres.map((genre) => <li key={genre} className="rounded-full px-3 py-1 ring-1 ring-inset ring-white/15">{genre}</li>)}
          </ul>
        )}
        {description !== null && <HeroDescription text={description} />}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          {next !== null && (
            <button type="button" data-tv-primary onClick={handlePlay} className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-semibold text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Play className="size-4 fill-current" />
              {next.label}
            </button>
          )}
          {media !== undefined && (
            <a href={media.siteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              AniList
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
