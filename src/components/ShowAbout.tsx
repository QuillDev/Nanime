import { ChevronRight, ExternalLink } from "lucide-react";

interface ShowAboutProps {
  readonly description: string | null;
  readonly genres: readonly string[];
  /** "2006", "2 seasons", "50 episodes": the line that sits under the title on wide screens. */
  readonly facts: readonly string[];
  readonly romaji: string | null;
  readonly siteUrl: string | undefined;
}

/** On phones everything about the show but its title waits under one closed heading, so the episodes come first. */
export function ShowAbout({ description, genres, facts, romaji, siteUrl }: ShowAboutProps): React.JSX.Element {
  return (
    <details className="group/about mb-6 sm:hidden">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <h2 className="font-display text-2xl font-bold tracking-tight">About</h2>
        <ChevronRight className="size-5 text-muted-foreground transition-transform group-open/about:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <div className="mt-3 grid gap-3.5 text-sm text-muted-foreground">
        {description !== null && <p className="whitespace-pre-line leading-6">{description}</p>}
        {genres.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-[13px]">
            {genres.map((genre) => <li key={genre} className="rounded-full px-3 py-1 ring-1 ring-inset ring-white/15">{genre}</li>)}
          </ul>
        )}
        <p>{facts.join(" · ")}</p>
        {romaji !== null && <p>{romaji}</p>}
        {siteUrl !== undefined && (
          <a href={siteUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1.5 hover:text-foreground">
            AniList
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
    </details>
  );
}
