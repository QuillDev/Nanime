import { RefreshCw } from "lucide-react";

/** One maintenance task: what it covers, its last run, and the button that runs it again. */
export function MaintenanceRow({ title, detail, busy, action, onAction, error, progress = null }: {
  readonly title: string;
  readonly detail: string;
  readonly busy: boolean;
  readonly action: string;
  readonly onAction: () => void;
  readonly error: string | null;
  readonly progress?: number | null;
}): React.JSX.Element {
  return (
    <li className="flex items-center gap-4 border-b border-border py-3.5">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{detail}</p>
        {progress !== null && <progress aria-label={`${title} progress`} max={1} value={progress} className="playback-progress mt-2 block h-0.75 w-full max-w-md" />}
        {error !== null && <p className="mt-1 select-text text-[13px] text-destructive">{error}</p>}
      </div>
      <button type="button" onClick={onAction} disabled={busy} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-secondary px-3.5 text-sm font-medium hover:bg-accent disabled:text-muted-foreground">
        <RefreshCw className={`size-4 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`} />
        {action}
      </button>
    </li>
  );
}
