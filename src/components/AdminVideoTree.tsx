import { useCallback, type ChangeEvent } from "react";
import { Check, ChevronDown, Minus } from "lucide-react";
import { formatSize } from "../format.ts";
import { mediaTitle } from "../lib/anilist.ts";
import { seasonMetadata, seasonNumber, showMetadataKey, type SeasonGroup, type ShowGroup } from "../lib/library.ts";
import type { AniListMedia, MediaEntry, ShowMetadata } from "../types.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.tsx";

type SelectionState = "checked" | "mixed" | "unchecked";

function selectionState(entries: readonly MediaEntry[], selected: ReadonlySet<string>): SelectionState {
  const count = entries.reduce((total, entry) => total + Number(selected.has(entry.rel)), 0);
  if (count === 0) {
    return "unchecked";
  }
  return count === entries.length ? "checked" : "mixed";
}

function totalSize(entries: readonly MediaEntry[]): number {
  return entries.reduce((total, entry) => total + entry.size, 0);
}

function TreeCheckbox({ state, label, disabled, handleToggle }: {
  readonly state: SelectionState;
  readonly label: string;
  readonly disabled: boolean;
  readonly handleToggle: () => void;
}): React.JSX.Element {
  const handleChange = useCallback((_event: ChangeEvent<HTMLInputElement>) => handleToggle(), [handleToggle]);
  return (
    <label className="relative flex size-5 shrink-0 cursor-pointer items-center justify-center rounded border border-border bg-background text-primary has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:cursor-not-allowed has-disabled:text-muted-foreground">
      <input type="checkbox" checked={state === "checked"} aria-checked={state === "mixed" ? "mixed" : state === "checked"} aria-label={label} disabled={disabled} onChange={handleChange} className="absolute inset-0 opacity-0" />
      {state === "checked" && <Check aria-hidden="true" className="size-3.5 stroke-[3]" />}
      {state === "mixed" && <Minus aria-hidden="true" className="size-3.5 stroke-[3]" />}
    </label>
  );
}

function EpisodeTreeRow({ entry, selected, selectionFull, onToggleEntries }: {
  readonly entry: MediaEntry;
  readonly selected: boolean;
  readonly selectionFull: boolean;
  readonly onToggleEntries: (entries: readonly MediaEntry[]) => void;
}): React.JSX.Element {
  const handleToggle = useCallback(() => onToggleEntries([entry]), [entry, onToggleEntries]);
  return (
    <li className="relative ml-7 grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-3 py-2 before:absolute before:-left-4 before:top-0 before:h-1/2 before:w-3 before:rounded-bl-md before:border-b before:border-l before:border-border after:absolute after:-left-4 after:bottom-0 after:top-1/2 after:border-l after:border-border last:after:hidden">
      <TreeCheckbox state={selected ? "checked" : "unchecked"} label={`Select ${entry.name}`} disabled={!selected && selectionFull} handleToggle={handleToggle} />
      <span className="truncate text-sm text-foreground">{entry.name.replace(/\.[^.]+$/u, "")}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{formatSize(entry.size)}</span>
    </li>
  );
}

function SeasonTree({ season, media, selected, selectionFull, defaultOpen, onToggleEntries }: {
  readonly season: SeasonGroup;
  readonly media: AniListMedia | undefined;
  readonly selected: ReadonlySet<string>;
  readonly selectionFull: boolean;
  readonly defaultOpen: boolean;
  readonly onToggleEntries: (entries: readonly MediaEntry[]) => void;
}): React.JSX.Element {
  const state = selectionState(season.entries, selected);
  const handleToggle = useCallback(() => onToggleEntries(season.entries), [onToggleEntries, season.entries]);
  const title = media === undefined ? season.name : mediaTitle(media);
  return (
    <Collapsible defaultOpen={defaultOpen} asChild>
      <li className="relative ml-7 before:absolute before:-left-4 before:bottom-0 before:top-0 before:border-l before:border-border last:before:bottom-1/2">
        <div className="relative flex min-w-0 items-center gap-3 py-2.5 before:absolute before:-left-4 before:top-1/2 before:w-3 before:border-t before:border-border">
          <TreeCheckbox state={state} label={`Select ${title}`} disabled={state === "unchecked" && selectionFull} handleToggle={handleToggle} />
          <CollapsibleTrigger asChild>
            <button type="button" className="collapsible-trigger flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronDown aria-hidden="true" className="collapsible-chevron size-4 shrink-0 text-muted-foreground" />
              <span className="w-7 shrink-0 text-xs font-medium text-muted-foreground">S{String(seasonNumber(season, media))}</span>
              <span className="truncate text-sm font-semibold">{title}</span>
              <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{String(season.entries.length)} episodes · {formatSize(totalSize(season.entries))}</span>
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent><ul>{season.entries.map((entry) => <EpisodeTreeRow key={entry.rel} entry={entry} selected={selected.has(entry.rel)} selectionFull={selectionFull} onToggleEntries={onToggleEntries} />)}</ul></CollapsibleContent>
      </li>
    </Collapsible>
  );
}

function resolvedShowTitle(show: ShowGroup, media: AniListMedia | undefined): string {
  return media === undefined ? show.name : mediaTitle(media);
}

export function AdminVideoTree({ shows, metadata, selected, forceOpen, onToggleEntries }: {
  readonly shows: readonly ShowGroup[];
  readonly metadata: ShowMetadata;
  readonly selected: ReadonlySet<string>;
  readonly forceOpen: boolean;
  readonly onToggleEntries: (entries: readonly MediaEntry[]) => void;
}): React.JSX.Element {
  return <ul>{shows.map((show) => <ShowTree key={`${show.name}:${String(forceOpen)}`} show={show} metadata={metadata} selected={selected} selectionFull={selected.size >= 100} forceOpen={forceOpen} onToggleEntries={onToggleEntries} />)}</ul>;
}

function ShowTree({ show, metadata, selected, selectionFull, forceOpen, onToggleEntries }: {
  readonly show: ShowGroup;
  readonly metadata: ShowMetadata;
  readonly selected: ReadonlySet<string>;
  readonly selectionFull: boolean;
  readonly forceOpen: boolean;
  readonly onToggleEntries: (entries: readonly MediaEntry[]) => void;
}): React.JSX.Element {
  const media = metadata[showMetadataKey(show.name)];
  const title = resolvedShowTitle(show, media);
  const cover = media?.coverImage.extraLarge ?? media?.coverImage.large;
  const state = selectionState(show.entries, selected);
  const handleToggle = useCallback(() => onToggleEntries(show.entries), [onToggleEntries, show.entries]);
  return (
    <Collapsible defaultOpen={forceOpen} asChild>
      <li className="border-b border-border last:border-b-0">
        <div className="grid grid-cols-[1.25rem_3rem_minmax(0,1fr)] items-center gap-3 px-3 py-3">
          <TreeCheckbox state={state} label={`Select ${title}`} disabled={state === "unchecked" && selectionFull} handleToggle={handleToggle} />
          <MediaThumbnail rel={show.entries[0]?.rel ?? ""} source={cover} className="aspect-[2/3] w-12 rounded-sm" />
          <CollapsibleTrigger asChild>
            <button type="button" className="collapsible-trigger flex min-w-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronDown aria-hidden="true" className="collapsible-chevron size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0"><span className="block truncate font-semibold">{title}</span><span className="block text-xs text-muted-foreground">{String(show.seasons.length)} {show.seasons.length === 1 ? "season" : "seasons"} · {String(show.entries.length)} episodes · {formatSize(totalSize(show.entries))}</span></span>
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent><ul className="border-t border-border bg-card px-3 pb-2 pl-10">{show.seasons.map((season) => <SeasonTree key={`${season.sourceShow}/${season.name}`} season={season} media={seasonMetadata(metadata, season.sourceShow, season.name)} selected={selected} selectionFull={selectionFull} defaultOpen={forceOpen} onToggleEntries={onToggleEntries} />)}</ul></CollapsibleContent>
      </li>
    </Collapsible>
  );
}
