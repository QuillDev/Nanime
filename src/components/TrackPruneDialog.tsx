import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import { Check } from "lucide-react";
import { fetchSubtitleTracks, formatSize } from "../api.ts";
import { fetchAudioTracks } from "../audio.ts";
import { usePruneTracks } from "../hooks/usePruneTracks.ts";
import type { MediaEntry, TrackPruneOperation } from "../types.ts";
import { TrackTypeSelector } from "./TrackTypeSelector.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible.tsx";

type PruneMode = "audio" | "subtitles";
interface ManagedTrack { readonly index: number; readonly label: string; readonly sizeBytes: number | null }
type TrackSelections = Readonly<Record<string, readonly number[]>>;
const EMPTY_TRACKS: readonly ManagedTrack[] = [];
const EMPTY_SELECTION: readonly number[] = [];

interface TrackPruneDialogProps {
  readonly entries: readonly MediaEntry[];
  readonly mode: PruneMode;
  readonly onClose: () => void;
  readonly onPruned: () => void;
}

function useTrackQueries(entries: readonly MediaEntry[], mode: PruneMode) {
  return useQueries({
    queries: entries.map((entry) => ({
      queryKey: [mode === "audio" ? "audio-tracks" : "subtitle-tracks", entry.rel],
      queryFn: ({ signal }: { readonly signal: AbortSignal }) => mode === "audio"
        ? fetchAudioTracks(entry.rel, signal)
        : fetchSubtitleTracks(entry.rel, signal),
      staleTime: 0,
    })),
  });
}

function TrackGroup({
  entry,
  tracks,
  selected,
  mode,
  onToggle,
}: {
  readonly entry: MediaEntry;
  readonly tracks: readonly ManagedTrack[];
  readonly selected: readonly number[];
  readonly mode: PruneMode;
  readonly onToggle: (event: ChangeEvent<HTMLInputElement>) => void;
}): React.JSX.Element {
  const removable = mode === "subtitles" ? tracks.length : Math.max(0, tracks.length - 1);
  const selectedSet = new Set(selected);
  return (
    <fieldset className="border-t border-border py-4 first:border-t-0 first:pt-0">
      <legend className="mb-2 max-w-full truncate text-sm font-medium">{entry.name}</legend>
      {removable === 0 && (
        <p className="text-xs text-muted-foreground">
          {mode === "audio" ? "Only one audio track; nothing can be pruned." : "No subtitle tracks found."}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {tracks.map((track) => {
          const checked = selectedSet.has(track.index);
          const disabled = mode === "audio" && !checked && selected.length >= removable;
          return (
            <label key={track.index} className="flex min-w-0 cursor-pointer items-center gap-3 rounded-md border border-border bg-secondary px-3 py-2.5 text-sm has-disabled:cursor-not-allowed has-disabled:text-muted-foreground">
              <input
                type="checkbox"
                data-path={entry.rel}
                value={track.index}
                checked={checked}
                disabled={disabled}
                onChange={onToggle}
                className="sr-only"
              />
              <span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}>
                {checked && <Check className="size-3.5 stroke-[3]" />}
              </span>
              <span className="min-w-0 flex-1 truncate">{track.label}</span>
              {track.sizeBytes !== null && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">≈ {formatSize(track.sizeBytes)}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function operationsFor(
  entries: readonly MediaEntry[],
  selections: TrackSelections,
  mode: PruneMode,
): readonly TrackPruneOperation[] {
  return entries.flatMap((entry) => {
    const indices = selections[entry.rel] ?? [];
    return indices.length === 0 ? [] : [{
      path: entry.rel,
      audioIndices: mode === "audio" ? indices : [],
      subtitleIndices: mode === "subtitles" ? indices : [],
    }];
  });
}

interface TrackTypeToggle {
  readonly entries: readonly MediaEntry[];
  readonly tracksByEntry: readonly (readonly ManagedTrack[])[];
  readonly label: string;
  readonly mode: PruneMode;
}

function allMatchingSelected(current: TrackSelections, toggle: TrackTypeToggle): boolean {
  const matches: boolean[] = [];
  toggle.entries.forEach((entry, index) => {
    for (const track of toggle.tracksByEntry[index] ?? EMPTY_TRACKS) {
      if (track.label === toggle.label) {
        matches.push(current[entry.rel]?.includes(track.index) ?? false);
      }
    }
  });
  return matches.length > 0 && matches.every(Boolean);
}

function toggleTypeSelections(current: TrackSelections, toggle: TrackTypeToggle): TrackSelections {
  const remove = allMatchingSelected(current, toggle);
  const next = { ...current };
  toggle.entries.forEach((entry, index) => {
    const tracks = toggle.tracksByEntry[index] ?? EMPTY_TRACKS;
    const selected = new Set(current[entry.rel]);
    for (const track of tracks.filter((candidate) => candidate.label === toggle.label)) {
      if (remove) {selected.delete(track.index);} else if (toggle.mode === "subtitles" || selected.size < tracks.length - 1) {selected.add(track.index);}
    }
    next[entry.rel] = [...selected];
  });
  return next;
}

function usePruneSelection(entries: readonly MediaEntry[], mode: PruneMode) {
  const [selections, setSelections] = useState<TrackSelections>({});
  const operations = useMemo(() => operationsFor(entries, selections, mode), [entries, mode, selections]);
  const selectedTrackCount = useMemo(() => operations.reduce(
    (total, operation) => total + operation.audioIndices.length + operation.subtitleIndices.length,
    0,
  ), [operations]);
  const handleToggle = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const path = event.currentTarget.dataset["path"] ?? "";
    const index = Number(event.currentTarget.value);
    const { checked } = event.currentTarget;
    if (!Number.isInteger(index)) {return;}
    setSelections((current) => {
      const existing = current[path] ?? [];
      return {
        ...current,
        [path]: checked ? [...existing, index] : existing.filter((value) => value !== index),
      };
    });
  }, []);
  const handleToggleType = useCallback((label: string, tracksByEntry: readonly (readonly ManagedTrack[])[]) => {
    setSelections((current) => toggleTypeSelections(current, { entries, tracksByEntry, label, mode }));
  }, [entries, mode]);
  return { selections, operations, selectedTrackCount, handleToggle, handleToggleType };
}

function IndividualTrackGroups({ entries, tracksByEntry, selections, mode, onToggle }: {
  readonly entries: readonly MediaEntry[];
  readonly tracksByEntry: readonly (readonly ManagedTrack[])[];
  readonly selections: TrackSelections;
  readonly mode: PruneMode;
  readonly onToggle: (event: ChangeEvent<HTMLInputElement>) => void;
}): React.JSX.Element {
  const groups = entries.map((entry, index) => (
    <TrackGroup key={entry.rel} entry={entry} tracks={tracksByEntry[index] ?? EMPTY_TRACKS} selected={selections[entry.rel] ?? EMPTY_SELECTION} mode={mode} onToggle={onToggle} />
  ));
  if (entries.length === 1) {return <div>{groups}</div>;}
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-3 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <CollapsibleChevron className="size-4" /> Review individual episodes
      </CollapsibleTrigger>
      <CollapsibleContent>{groups}</CollapsibleContent>
    </Collapsible>
  );
}

export function TrackPruneDialog({
  entries,
  mode,
  onClose,
  onPruned,
}: TrackPruneDialogProps): React.JSX.Element {
  const queries = useTrackQueries(entries, mode);
  const pruning = usePruneTracks();
  const selection = usePruneSelection(entries, mode);
  const handlePrune = useCallback(() => {
    pruning.mutate(selection.operations, { onSuccess: () => {
      onPruned();
      onClose();
    } });
  }, [onClose, onPruned, pruning, selection.operations]);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && !pruning.isPending) {
      onClose();
    }
  }, [onClose, pruning.isPending]);
  const pending = queries.some((query) => query.isPending);
  const queryError = queries.find((query) => query.error !== null)?.error ?? null;
  const tracksByEntry = useMemo(() => queries.map((query) => (query.data ?? EMPTY_TRACKS) as readonly ManagedTrack[]), [queries]);
  const paths = useMemo(() => entries.map((entry) => entry.rel), [entries]);
  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Remove {mode === "audio" ? "audio" : "subtitle"} tracks</DialogTitle>
          <DialogDescription>
            Select the exact tracks to remove permanently. Embedded tracks are remuxed without
            changing video quality. Associated qBittorrent tasks will be detached.
          </DialogDescription>
        </DialogHeader>
        {pending && <p className="py-8 text-center text-sm text-muted-foreground">Scanning tracks…</p>}
        {queryError !== null && <p className="select-text text-sm text-destructive">{queryError.message}</p>}
        {!pending && queryError === null && entries.length > 1 && <TrackTypeSelector paths={paths} tracksByEntry={tracksByEntry} selections={selection.selections} onToggleType={selection.handleToggleType} />}
        {!pending && queryError === null && <IndividualTrackGroups entries={entries} tracksByEntry={tracksByEntry} selections={selection.selections} mode={mode} onToggle={selection.handleToggle} />}
        {pruning.error !== null && <p className="select-text text-sm text-destructive">{pruning.error.message}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={pruning.isPending} className="h-10 rounded-md border border-border bg-background px-4 text-sm font-semibold hover:bg-accent">Cancel</button>
          <button type="button" onClick={handlePrune} disabled={pending || selection.operations.length === 0 || pruning.isPending} className="h-10 rounded-md bg-destructive px-4 text-sm font-semibold text-destructive-foreground disabled:bg-muted disabled:text-muted-foreground">
            {pruning.isPending ? "Removing…" : `Remove ${String(selection.selectedTrackCount)} ${selection.selectedTrackCount === 1 ? "track" : "tracks"} from ${String(selection.operations.length)} ${selection.operations.length === 1 ? "video" : "videos"}`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
