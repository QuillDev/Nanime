import { useCallback, type ChangeEvent } from "react";
import { Captions, Languages, ScanSearch, Trash2, WandSparkles } from "lucide-react";
import { useMediaScans, useStartMediaScans } from "../hooks/useMediaScans.ts";
import type { MediaEntry, MediaScan, TranscodePreset } from "../types.ts";

type PruneMode = "audio" | "subtitles";

function scanSummary(scans: readonly MediaScan[]): string {
  const counts = { complete: 0, scanning: 0, queued: 0, failed: 0 };
  for (const scan of scans) {counts[scan.status] += 1;}
  return `Media scans: ${String(counts.complete)} cached · ${String(counts.scanning)} active · ${String(counts.queued)} queued${counts.failed > 0 ? ` · ${String(counts.failed)} failed` : ""}`;
}

export function AdminVideoActions({ selectedEntries, preset, pending, onPreset, onTranscode, onPrune, onAddSubtitles, onDelete }: {
  readonly selectedEntries: readonly MediaEntry[];
  readonly preset: TranscodePreset;
  readonly pending: boolean;
  readonly onPreset: (event: ChangeEvent<HTMLSelectElement>) => void;
  readonly onTranscode: () => void;
  readonly onPrune: (mode: PruneMode) => void;
  readonly onAddSubtitles: () => void;
  readonly onDelete: () => void;
}): React.JSX.Element {
  const scans = useMediaScans();
  const startScan = useStartMediaScans();
  const selected = selectedEntries.length;
  const handleAudio = useCallback(() => onPrune("audio"), [onPrune]);
  const handleSubtitles = useCallback(() => onPrune("subtitles"), [onPrune]);
  const handleScan = useCallback(() => startScan.mutate(selectedEntries.map((entry) => entry.rel)), [selectedEntries, startScan]);
  const disabled = selected === 0 || pending;
  return (
    <div className="space-y-2 rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm font-medium">{String(selected)} selected</span>
        <select value={preset} onChange={onPreset} aria-label="Transcode preset" className="h-9 rounded-md border border-border bg-secondary px-3 text-sm"><option value="space-saver">Space Saver</option><option value="compatibility">Compatibility</option></select>
        <button type="button" onClick={onTranscode} disabled={disabled} className="flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"><WandSparkles className="size-4" /> {pending ? "Queueing…" : "Transcode"}</button>
        <button type="button" onClick={handleScan} disabled={selected === 0 || startScan.isPending} className="flex h-9 items-center gap-2 rounded-md bg-secondary px-3 text-sm font-semibold disabled:text-muted-foreground"><ScanSearch className="size-4" /> {startScan.isPending ? "Queueing…" : "Scan"}</button>
        <button type="button" onClick={onAddSubtitles} disabled={selected !== 1} className="flex h-9 items-center gap-2 rounded-md bg-secondary px-3 text-sm font-semibold disabled:text-muted-foreground"><Captions className="size-4" /> Add subtitles</button>
        <button type="button" onClick={handleAudio} disabled={selected === 0} className="flex h-9 items-center gap-2 rounded-md bg-secondary px-3 text-sm font-semibold disabled:text-muted-foreground"><Languages className="size-4" /> Prune audio</button>
        <button type="button" onClick={handleSubtitles} disabled={selected === 0} className="flex h-9 items-center gap-2 rounded-md bg-secondary px-3 text-sm font-semibold disabled:text-muted-foreground"><Captions className="size-4" /> Prune subtitles</button>
        <button type="button" onClick={onDelete} disabled={selected === 0} className="flex h-9 items-center gap-2 rounded-md bg-destructive px-3 text-sm font-semibold text-destructive-foreground disabled:bg-muted disabled:text-muted-foreground"><Trash2 className="size-4" /> Delete files</button>
      </div>
      {scans.data !== undefined && scans.data.length > 0 && <p className="text-xs text-muted-foreground">{scanSummary(scans.data)}</p>}
      {startScan.error !== null && <p className="select-text text-xs text-destructive">{startScan.error.message}</p>}
    </div>
  );
}
