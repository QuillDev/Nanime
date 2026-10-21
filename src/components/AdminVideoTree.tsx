import { useCallback, useMemo, type ChangeEvent } from "react";
import { Check, ChevronRight, Minus } from "lucide-react";
import { formatSize } from "../format.ts";
import { episodeShortLabel, profileEpisode, type ProfileEpisodes } from "../lib/profileMedia.ts";
import { seasonMetadata, seasonNumber, showMetadataKey, type SeasonGroup, type ShowGroup } from "../lib/library.ts";
import { showTitle } from "../lib/videoFilters.ts";
import { needsTranscodeCount, type VideoStatus } from "../lib/videoStatus.ts";
import type { MediaEntry, ShowMetadata } from "../types.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.tsx";

type SelectionState = "checked" | "mixed" | "unchecked";

export interface VideoTreeContext {
  readonly metadata: ShowMetadata;
  readonly episodes: ProfileEpisodes;
  readonly statuses: ReadonlyMap<string, VideoStatus>;
  readonly selected: ReadonlySet<string>;
  readonly selectionFull: boolean;
  readonly onToggleEntries: (entries: readonly MediaEntry[]) => void;
}

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

function SelectBox({ entries, label, context }: {
  readonly entries: readonly MediaEntry[];
  readonly label: string;
  readonly context: VideoTreeContext;
}): React.JSX.Element {
  const { selected, selectionFull, onToggleEntries } = context;
  const state = selectionState(entries, selected);
  const handleChange = useCallback((_event: ChangeEvent<HTMLInputElement>) => onToggleEntries(entries), [entries, onToggleEntries]);
  return (
    <label className="relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded border border-muted-foreground/60 text-primary-foreground has-checked:border-primary has-checked:bg-primary has-[[aria-checked=mixed]]:border-primary has-[[aria-checked=mixed]]:bg-primary has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:cursor-not-allowed has-disabled:opacity-40">
      <input type="checkbox" checked={state === "checked"} aria-checked={state === "mixed" ? "mixed" : state === "checked"} aria-label={label} disabled={state === "unchecked" && selectionFull} onChange={handleChange} className="absolute inset-0 opacity-0" />
      {state === "checked" && <Check aria-hidden="true" className="size-3 stroke-[3]" />}
      {state === "mixed" && <Minus aria-hidden="true" className="size-3 stroke-[3]" />}
    </label>
  );
}

function CodecTag({ status }: { readonly status: VideoStatus | undefined }): React.JSX.Element | null {
  if (status?.codec === null || status === undefined) {
    return null;
  }
  const label = [status.codec, status.resolution].filter((part) => part !== null).join(" · ");
  return (
    <span title={status.needsTranscode ? "Needs a transcode for browsers without HEVC" : undefined} className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${status.needsTranscode ? "bg-warning/10 text-warning" : "bg-secondary text-muted-foreground"}`}>
      {label}
    </span>
  );
}

function EpisodeRow({ entry, context }: { readonly entry: MediaEntry; readonly context: VideoTreeContext }): React.JSX.Element {
  const episode = profileEpisode(context.episodes, entry.rel);
  const label = episodeShortLabel(episode);
  const only = useMemo(() => [entry], [entry]);
  return (
    <li className="flex items-center gap-3.5 border-b border-border py-2 pl-14 last:border-b-0">
      <SelectBox entries={only} label={`Select ${entry.name}`} context={context} />
      <span className="w-[4.5rem] shrink-0 overflow-hidden rounded"><MediaThumbnail rel={entry.rel} source={episode.thumbnail} sizes="72px" className="w-full" /></span>
      <span className="min-w-0 flex-1 truncate text-sm" title={entry.rel}>
        {label !== "" && <span className="font-medium">{label} </span>}
        <span className="text-muted-foreground">{episode.title}</span>
      </span>
      <CodecTag status={context.statuses.get(entry.rel)} />
      <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">{formatSize(entry.size)}</span>
    </li>
  );
}

function SeasonRows({ season, show, labelled, context }: {
  readonly season: SeasonGroup;
  readonly show: ShowGroup;
  readonly labelled: boolean;
  readonly context: VideoTreeContext;
}): React.JSX.Element {
  const media = seasonMetadata(context.metadata, season.sourceShow, season.name) ?? context.metadata[showMetadataKey(show.name)];
  return (
    <li>
      {labelled && (
        <p className="flex items-center gap-3.5 pb-1 pl-14 pt-3 text-xs font-semibold text-muted-foreground">
          <SelectBox entries={season.entries} label={`Select season ${String(seasonNumber(season, media))}`} context={context} />
          Season {String(seasonNumber(season, media))} · {String(season.entries.length)} episodes
        </p>
      )}
      <ul>{season.entries.map((entry) => <EpisodeRow key={entry.rel} entry={entry} context={context} />)}</ul>
    </li>
  );
}

function ShowRow({ show, defaultOpen, context }: {
  readonly show: ShowGroup;
  readonly defaultOpen: boolean;
  readonly context: VideoTreeContext;
}): React.JSX.Element {
  const media = context.metadata[showMetadataKey(show.name)];
  const title = showTitle(show, context.metadata);
  const needs = needsTranscodeCount(show.entries.map((entry) => entry.rel), context.statuses);
  return (
    <Collapsible defaultOpen={defaultOpen} asChild>
      <li className="border-b border-border">
        <div className="flex items-center gap-3.5 py-3">
          <SelectBox entries={show.entries} label={`Select ${title}`} context={context} />
          <CollapsibleTrigger asChild>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-90" />
              <MediaThumbnail rel={show.entries[0]?.rel ?? ""} source={media?.coverImage.large ?? media?.coverImage.extraLarge} art="cover" sizes="44px" className="aspect-[2/3] w-11 shrink-0 rounded-md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{title}</span>
                <span className="block text-[13px] text-muted-foreground">{String(show.entries.length)} {show.entries.length === 1 ? "episode" : "episodes"} · {formatSize(totalSize(show.entries))}</span>
              </span>
              {needs > 0 && <span className="shrink-0 text-xs font-semibold text-warning">{String(needs)} need transcode</span>}
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <ul className="pb-2">{show.seasons.map((season) => <SeasonRows key={`${season.sourceShow}/${season.name}`} season={season} show={show} labelled={show.seasons.length > 1} context={context} />)}</ul>
        </CollapsibleContent>
      </li>
    </Collapsible>
  );
}

export function AdminVideoTree({ shows, forceOpen, context }: {
  readonly shows: readonly ShowGroup[];
  readonly forceOpen: boolean;
  readonly context: VideoTreeContext;
}): React.JSX.Element {
  return <ul>{shows.map((show) => <ShowRow key={`${show.name}:${String(forceOpen)}`} show={show} defaultOpen={forceOpen} context={context} />)}</ul>;
}
