import { Check, Minus } from "lucide-react";
import { formatSize } from "../format.ts";

interface TrackSelectionContentProps {
  readonly label: string;
  readonly state: "checked" | "mixed" | "unchecked";
  readonly detail?: string;
  readonly sizeBytes?: number | null;
}

export function TrackSelectionContent({
  label,
  state,
  detail,
  sizeBytes,
}: TrackSelectionContentProps): React.JSX.Element {
  const selected = state !== "unchecked";
  return (
    <>
      <span
        aria-hidden="true"
        className={`flex size-5 shrink-0 items-center justify-center rounded border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}
      >
        {state === "checked" && <Check className="size-3.5 stroke-[3]" />}
        {state === "mixed" && <Minus className="size-3.5 stroke-[3]" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {(detail !== undefined || sizeBytes !== undefined && sizeBytes !== null) && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {detail}
          {detail !== undefined && sizeBytes !== undefined && sizeBytes !== null ? " · " : ""}
          {sizeBytes !== undefined && sizeBytes !== null ? `≈ ${formatSize(sizeBytes)}` : ""}
        </span>
      )}
    </>
  );
}
