import { useCallback, useState } from "react";
import { ArrowLeft, ExternalLink, Link, Play } from "lucide-react";
import type { AniListMedia, MediaEntry, PlaybackProgressMap, ShowMetadata } from "../types.ts";
import { isMovieMedia, seasonMetadata, seasonNumber, type ShowGroup } from "../lib/library.ts";
import { episodeNumber, mediaTitle } from "../lib/anilist.ts";
import { thumbnailUrl } from "../api.ts";
import { cn } from "../lib/utils.ts";
import { ShowAbout } from "./ShowAbout.tsx";
import { HeroArt } from "./HeroArt.tsx";
import { artSources, posterArt } from "../lib/art.ts";

interface ShowHeroProps {
  readonly show: ShowGroup;
  readonly media: AniListMedia | undefined;
  readonly metadata: ShowMetadata;
  readonly progress: PlaybackProgressMap;
  readonly onBack: () => void;
  readonly onLink?: (() => void) | undefined;
  readonly onPlay: (entry: MediaEntry) => void;
}

interface NextEpisode {
  readonly entry: MediaEntry;
  readonly label: string;
}

/** "S2E14": the season's stated number (1 when it states none) and the episode's. Nothing for a movie or an unnumbered file. */
function episodeCode(show: ShowGroup, entry: MediaEntry, metadata: ShowMetadata): string | null {
  const number = episodeNumber(entry);
  const season = show.seasons.find((candidate) => candidate.entries.includes(entry));
  const media = season === undefined ? undefined : seasonMetadata(metadata, season.sourceShow, season.name);
  if (number === null || season === undefined || isMovieMedia(media)) {
    return null;
  }
  return `S${String(seasonNumber(season, media))}E${String(number)}`;
}

function playVerb(show: ShowGroup, progress: PlaybackProgressMap, finished: boolean): string {
  if (finished) {
    return "Watch again";
  }
  return show.entries.some((entry) => progress[entry.rel] !== undefined) ? "Continue" : "Play";
}

/** The first unfinished episode in library order, labeled the same way every time: "Continue: S2E14". */
function nextEpisode(show: ShowGroup, progress: PlaybackProgressMap, metadata: ShowMetadata): NextEpisode | null {
  const entries = show.seasons.flatMap((season) => season.entries);
  const next = entries.find((entry) => progress[entry.rel]?.completed !== true);
  const entry = next ?? entries[0];
  if (entry === undefined) {
    return null;
  }
  const verb = playVerb(show, progress, next === undefined);
  const code = episodeCode(show, entry, metadata);
  return { entry, label: code === null ? verb : `${verb}: ${code}` };
}

function showFactList(show: ShowGroup, media: AniListMedia | undefined): readonly string[] {
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

const WIDE_FADE = "bg-[linear-gradient(90deg,rgb(0_0_0/0.96)_0%,rgb(0_0_0/0.78)_42%,rgb(0_0_0/0.15)_80%),linear-gradient(0deg,rgb(0_0_0)_0%,transparent_55%)]";

function HeroBackdrop({ show, media }: { readonly show: ShowGroup; readonly media: AniListMedia | undefined }): React.JSX.Element {
  const banner = media?.bannerImage ?? null;
  const cover = media?.coverImage.extraLarge ?? media?.coverImage.large ?? null;
  const fallback = show.entries[0] === undefined ? null : thumbnailUrl(show.entries[0].rel);
  const source = banner ?? cover ?? fallback;
  const wide = source === null ? null : artSources(source, banner === null ? "cover" : "banner");
  return <HeroArt wide={wide} poster={posterArt(media)} blurred={banner === null} wideFade={WIDE_FADE} />;
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

/** The show's genres and synopsis over the art; phones keep them under the About heading below the banner. */
function HeroAbout({ text }: { readonly text: HeroText }): React.JSX.Element {
  return (
    <div className="mt-4 hidden sm:block">
      {text.genres.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-[13px] text-muted-foreground">
          {text.genres.map((genre) => <li key={genre} className="rounded-full px-3 py-1 ring-1 ring-inset ring-white/15">{genre}</li>)}
        </ul>
      )}
      {text.description !== null && <HeroDescription text={text.description} />}
    </div>
  );
}

export function ShowHero({ show, media, metadata, progress, onBack, onLink, onPlay }: ShowHeroProps): React.JSX.Element {
  const next = nextEpisode(show, progress, metadata);
  const handlePlay = useCallback(() => {
    if (next !== null) {
      onPlay(next.entry);
    }
  }, [next, onPlay]);
  const text = heroText(show, media);
  const facts = showFactList(show, media);
  const linkLabel = media === undefined ? "Match show metadata" : "Change metadata match";
  return (
    <>
    <section className="relative isolate mx-[calc(50%-50vw)] -mt-[calc(var(--header-height)+1.5rem)] mb-6 flex min-h-[600px] items-end overflow-hidden sm:mb-8 sm:min-h-[calc(420px+var(--header-height))]">
      <HeroBackdrop show={show} media={media} />
      {/* Pinned under the header, whatever the copy's height. On phones it sits on the poster itself, so it carries a backing like the banner's arrows. */}
      <div className="absolute inset-x-0 top-[calc(var(--header-height)+1.25rem)] z-10 mx-auto max-w-7xl px-6">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-full text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:-ml-2 max-sm:bg-black/45 max-sm:px-3 max-sm:py-1.5 max-sm:text-foreground">
          <ArrowLeft className="size-4" />
          All titles
        </button>
      </div>
      <div className="relative mx-auto w-full max-w-7xl px-6 pb-8 pt-[calc(var(--header-height)+4rem)]">
        <div className="flex max-w-3xl items-start gap-3">
          <h1 className="font-display text-4xl font-extrabold leading-[0.98] tracking-[-0.04em] text-balance sm:text-6xl">{text.title}</h1>
          {onLink !== undefined && (
            <button type="button" onClick={onLink} aria-label={linkLabel} title={linkLabel} className="mt-2 shrink-0 rounded-full p-2 text-muted-foreground hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Link className="size-4" />
            </button>
          )}
        </div>
        {text.romaji !== null && <p className="mt-2 hidden text-sm text-muted-foreground sm:block">{text.romaji}</p>}
        <p className="mt-3 hidden flex-wrap gap-x-2 text-[15px] text-muted-foreground sm:flex">
          {facts.map((fact, index) => (
            <span key={fact}>{index > 0 && <span aria-hidden="true" className="mr-2 text-muted-foreground/50">·</span>}{fact}</span>
          ))}
        </p>
        <HeroAbout text={text} />
        <div className="mt-6 flex flex-wrap items-center gap-4">
          {next !== null && (
            <button type="button" data-tv-primary onClick={handlePlay} className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-semibold text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Play className="size-4 fill-current" />
              {next.label}
            </button>
          )}
          {media !== undefined && (
            <a href={media.siteUrl} target="_blank" rel="noreferrer" className="hidden items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground sm:inline-flex">
              AniList
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      </div>
    </section>
    <ShowAbout description={text.description} genres={text.genres} facts={facts} romaji={text.romaji} siteUrl={media?.siteUrl} />
    </>
  );
}
