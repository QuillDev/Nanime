import { useCallback, type ChangeEvent } from "react";
import { Check, Minus } from "lucide-react";
import { formatSize } from "../api.ts";

interface ManagedTrack {
  readonly index: number;
  readonly label: string;
  readonly sizeBytes: number | null;
}

interface TrackType {
  readonly label: string;
  readonly count: number;
  readonly selected: number;
  readonly sizeBytes: number;
}

function trackTypes(
  tracksByEntry: readonly (readonly ManagedTrack[])[],
  selections: Readonly<Record<string, readonly number[]>>,
  paths: readonly string[],
): readonly TrackType[] {
  const types = new Map<string, { count: number; selected: number; sizeBytes: number }>();
  tracksByEntry.forEach((tracks, entryIndex) => {
    const selected = new Set(selections[paths[entryIndex] ?? ""]);
    for (const track of tracks) {
      const current = types.get(track.label) ?? { count: 0, selected: 0, sizeBytes: 0 };
      types.set(track.label, {
        count: current.count + 1,
        selected: current.selected + Number(selected.has(track.index)),
        sizeBytes: current.sizeBytes + (track.sizeBytes ?? 0),
      });
    }
  });
  return [...types.entries()]
    .map(([label, counts]) => ({ label, count: counts.count, selected: counts.selected, sizeBytes: counts.sizeBytes }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
}

function TrackTypeOption({ type, tracksByEntry, onToggleType }: {
  readonly type: TrackType;
  readonly tracksByEntry: readonly (readonly ManagedTrack[])[];
  readonly onToggleType: (label: string, tracksByEntry: readonly (readonly ManagedTrack[])[]) => void;
}): React.JSX.Element {
  const checked = type.selected === type.count;
  const partiallyChecked = type.selected > 0 && !checked;
  const handleChange = useCallback((_event: ChangeEvent<HTMLInputElement>) => {
    onToggleType(type.label, tracksByEntry);
  }, [onToggleType, tracksByEntry, type.label]);
  return (
    <label className="flex min-w-0 cursor-pointer items-center gap-3 rounded-md border border-border bg-secondary px-3 py-2.5 text-sm">
      <input type="checkbox" checked={checked} aria-checked={partiallyChecked ? "mixed" : checked} onChange={handleChange} className="sr-only" />
      <span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded border ${checked || partiallyChecked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}>
        {checked && <Check className="size-3.5 stroke-[3]" />}
        {partiallyChecked && <Minus className="size-3.5 stroke-[3]" />}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{type.label}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {type.selected === 0 ? String(type.count) : `${String(type.selected)}/${String(type.count)}`} tracks{type.sizeBytes > 0 ? ` · ≈ ${formatSize(type.sizeBytes)}` : ""}
      </span>
    </label>
  );
}

export function TrackTypeSelector({ paths, tracksByEntry, selections, onToggleType }: {
  readonly paths: readonly string[];
  readonly tracksByEntry: readonly (readonly ManagedTrack[])[];
  readonly selections: Readonly<Record<string, readonly number[]>>;
  readonly onToggleType: (label: string, tracksByEntry: readonly (readonly ManagedTrack[])[]) => void;
}): React.JSX.Element {
  const types = trackTypes(tracksByEntry, selections, paths);
  return (
    <section className="space-y-2 border-b border-border pb-4">
      <div>
        <h3 className="text-sm font-semibold">Apply to matching tracks</h3>
        <p className="text-xs text-muted-foreground">Select a track once to apply it across every matching episode.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {types.map((type) => <TrackTypeOption key={type.label} type={type} tracksByEntry={tracksByEntry} onToggleType={onToggleType} />)}
      </div>
    </section>
  );
}
