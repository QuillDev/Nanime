import { useCallback, type ChangeEvent } from "react";
import type { ManagedTrack } from "../trackPruning.ts";
import { TrackSelectionContent } from "./TrackSelectionContent.tsx";

export { TrackSelectionContent } from "./TrackSelectionContent.tsx";

interface TrackType {
  readonly label: string;
  readonly count: number;
  readonly selected: number;
  readonly sizeBytes: number;
}

function selectionState(checked: boolean, partiallyChecked: boolean) {
  if (checked) {
    return "checked" as const;
  }
  return partiallyChecked ? "mixed" as const : "unchecked" as const;
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
    <div className="relative flex min-w-0 items-center gap-3 rounded-md border border-border bg-secondary px-3 py-2.5 text-sm">
      <input
        type="checkbox"
        checked={checked}
        aria-label={`Apply ${type.label} selection to matching tracks`}
        aria-checked={partiallyChecked ? "mixed" : checked}
        onChange={handleChange}
        className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
      />
      <TrackSelectionContent
        label={type.label}
        state={selectionState(checked, partiallyChecked)}
        detail={`${type.selected === 0 ? String(type.count) : `${String(type.selected)}/${String(type.count)}`} tracks`}
        sizeBytes={type.sizeBytes > 0 ? type.sizeBytes : null}
      />
    </div>
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
