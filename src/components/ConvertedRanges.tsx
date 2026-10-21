import { useMemo } from "react";
import type { ConvertedProgress } from "../hlsApi.ts";

function percent(seconds: number, duration: number): string {
  return `${String(Math.min(Math.max(seconds / duration, 0), 1) * 100)}%`;
}

interface RangeMarkProps {
  readonly start: number;
  readonly end: number;
  readonly duration: number;
  readonly kind: "kept" | "converting";
}

function RangeMark({ start, end, duration, kind }: RangeMarkProps): React.JSX.Element {
  const position = useMemo(() => ({ left: percent(start, duration), width: percent(end - start, duration) }), [duration, end, start]);
  return (
    <span
      data-converted={kind}
      className={kind === "kept" ? "absolute inset-y-0 bg-sky-400" : "absolute inset-y-0 animate-pulse bg-amber-400"}
      style={position}
    />
  );
}

/** A strip under the seek bar: converted parts solid, parts converting now pulsing. */
export function ConvertedRanges({ progress }: { readonly progress: ConvertedProgress }): React.JSX.Element | null {
  const { duration } = progress;
  if (duration <= 0) {
    return null;
  }
  return (
    <span data-converted-ranges aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
      {progress.kept.map(([start, end]) => (
        <RangeMark key={`kept-${String(start)}`} kind="kept" start={start} end={end} duration={duration} />
      ))}
      {progress.converting.map(([start, end]) => (
        <RangeMark key={`converting-${String(start)}`} kind="converting" start={start} end={end} duration={duration} />
      ))}
    </span>
  );
}
