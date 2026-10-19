import { useCallback, useRef } from "react";
import { ChevronDown, X } from "lucide-react";
import { useStartMediaScans } from "../hooks/useMediaScans.ts";
import { useStartTranscode } from "../hooks/useTranscodes.ts";
import type { PruneMode } from "../trackPruning.ts";
import type { MediaEntry, TranscodePreset } from "../types.ts";

const action = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium hover:bg-accent disabled:opacity-40";
const menuItem = "flex w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none";

export interface BulkActions {
  readonly onPrune: (mode: PruneMode) => void;
  readonly onAddSubtitles: () => void;
  readonly onDelete: () => void;
  readonly onClear: () => void;
}

interface MenuChoice {
  readonly value: string;
  readonly label: string;
}

function MenuItem({ choice, onChoose }: { readonly choice: MenuChoice; readonly onChoose: (value: string) => void }): React.JSX.Element {
  const handleClick = useCallback(() => onChoose(choice.value), [choice.value, onChoose]);
  return <button type="button" role="menuitem" onClick={handleClick} className={menuItem}>{choice.label}</button>;
}

/** A bar button that opens a small menu upward, closing after a choice. */
function BarMenu({ label, choices, disabled, onChoose }: {
  readonly label: string;
  readonly choices: readonly MenuChoice[];
  readonly disabled: boolean;
  readonly onChoose: (value: string) => void;
}): React.JSX.Element {
  const menu = useRef<HTMLDetailsElement | null>(null);
  const handleChoose = useCallback((value: string) => {
    menu.current?.removeAttribute("open");
    onChoose(value);
  }, [onChoose]);
  return (
    <details ref={menu} className={`relative ${disabled ? "pointer-events-none opacity-40" : ""}`}>
      <summary className={`${action} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
        {label}
        <ChevronDown className="size-3.5" />
      </summary>
      <div role="menu" className="absolute bottom-10 left-0 z-30 min-w-52 rounded-md border border-border bg-popover p-1 shadow-lg">
        {choices.map((choice) => <MenuItem key={choice.value} choice={choice} onChoose={handleChoose} />)}
      </div>
    </details>
  );
}

const PRESET_CHOICES = [
  { value: "compatibility", label: "Compatibility (H.264)" },
  { value: "space-saver", label: "Space Saver (AV1)" },
] as const satisfies readonly MenuChoice[];

const PRUNE_CHOICES = [
  { value: "audio", label: "Audio tracks…" },
  { value: "subtitles", label: "Subtitle tracks…" },
] as const satisfies readonly MenuChoice[];

function useBulkJobs(selected: readonly MediaEntry[]) {
  const transcode = useStartTranscode();
  const scan = useStartMediaScans();
  const handleTranscode = useCallback((preset: TranscodePreset) => {
    transcode.mutate({ paths: selected.map((entry) => entry.rel), preset });
  }, [selected, transcode]);
  const handleScan = useCallback(() => scan.mutate(selected.map((entry) => entry.rel)), [scan, selected]);
  return { transcode, scan, handleTranscode, handleScan };
}

/** Floating bar with every bulk action; it appears only while videos are selected. */
export function AdminVideoBulkBar({ selected, actions }: {
  readonly selected: readonly MediaEntry[];
  readonly actions: BulkActions;
}): React.JSX.Element | null {
  const jobs = useBulkJobs(selected);
  const { handleTranscode } = jobs;
  const { onAddSubtitles: handleAddSubtitles, onPrune: handlePrune, onDelete: handleDelete, onClear: handleClear } = actions;
  const handlePreset = useCallback((value: string) => handleTranscode(value as TranscodePreset), [handleTranscode]);
  const handlePruneChoice = useCallback((value: string) => handlePrune(value as PruneMode), [handlePrune]);
  if (selected.length === 0) {
    return null;
  }
  const error = jobs.transcode.error ?? jobs.scan.error;
  return (
    <div className="sticky bottom-4 z-20 mt-4 flex w-fit max-w-full flex-wrap items-center gap-1 rounded-xl border border-border bg-popover py-1.5 pl-4 pr-1.5 shadow-2xl">
      <span className="mr-2 text-sm font-semibold tabular-nums">{String(selected.length)} selected</span>
      <BarMenu label={jobs.transcode.isPending ? "Queueing…" : "Transcode"} choices={PRESET_CHOICES} disabled={jobs.transcode.isPending} onChoose={handlePreset} />
      <button type="button" onClick={jobs.handleScan} disabled={jobs.scan.isPending} className={action}>Scan</button>
      <button type="button" onClick={handleAddSubtitles} disabled={selected.length !== 1} title={selected.length === 1 ? undefined : "Select one episode"} className={action}>Add subtitles</button>
      <BarMenu label="Remove tracks" choices={PRUNE_CHOICES} disabled={false} onChoose={handlePruneChoice} />
      <button type="button" onClick={handleDelete} className={`${action} text-destructive`}>Delete</button>
      <button type="button" onClick={handleClear} aria-label="Clear selection" title="Clear selection" className={`${action} px-2 text-muted-foreground`}><X className="size-4" /></button>
      {error !== null && <p className="w-full select-text px-1 pb-1 text-xs text-destructive">{error.message}</p>}
    </div>
  );
}
