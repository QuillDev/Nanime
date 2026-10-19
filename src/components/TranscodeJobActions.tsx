import { useCallback, useRef } from "react";
import { EllipsisVertical, RotateCw, X } from "lucide-react";
import { useCancelTranscode, useDeleteTranscode, useStartTranscode } from "../hooks/useTranscodes.ts";
import type { TranscodeJob } from "../types.ts";

const textButton = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50";
const menuItem = "flex w-full items-center rounded-sm px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50";

function FinishedMenu({ job }: { readonly job: TranscodeJob }): React.JSX.Element {
  const menu = useRef<HTMLDetailsElement | null>(null);
  const remove = useDeleteTranscode(false);
  const removeOriginal = useDeleteTranscode(true);
  const handleRemove = useCallback(() => {
    remove.mutate(job.id);
    menu.current?.removeAttribute("open");
  }, [job.id, remove]);
  const handleOriginal = useCallback(() => {
    removeOriginal.mutate(job.id);
    menu.current?.removeAttribute("open");
  }, [job.id, removeOriginal]);
  return (
    <details ref={menu} className="relative">
      <summary aria-label="More actions" className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&::-webkit-details-marker]:hidden">
        <EllipsisVertical className="size-4" />
      </summary>
      <div role="menu" className="absolute right-0 top-9 z-20 min-w-52 rounded-md border border-border bg-popover p-1 shadow-lg">
        <button type="button" role="menuitem" onClick={handleRemove} disabled={remove.isPending} className={menuItem}>Delete optimized copy</button>
        {!job.originalDeleted && (
          <button type="button" role="menuitem" onClick={handleOriginal} disabled={removeOriginal.isPending} className={`${menuItem} text-destructive`}>Delete original</button>
        )}
      </div>
    </details>
  );
}

function RetryButton({ job }: { readonly job: TranscodeJob }): React.JSX.Element {
  const start = useStartTranscode();
  const handleRetry = useCallback(() => start.mutate({ paths: [job.sourcePath], preset: job.preset }), [job.preset, job.sourcePath, start]);
  return (
    <button type="button" onClick={handleRetry} disabled={start.isPending} className={textButton}>
      <RotateCw className="size-3.5" />
      Retry
    </button>
  );
}

function CancelButton({ job }: { readonly job: TranscodeJob }): React.JSX.Element {
  const cancel = useCancelTranscode();
  const handleCancel = useCallback(() => cancel.mutate(job.id), [cancel, job.id]);
  return (
    <button type="button" onClick={handleCancel} disabled={cancel.isPending} className={textButton}>
      <X className="size-3.5" />
      Cancel
    </button>
  );
}

export function TranscodeJobActions({ job }: { readonly job: TranscodeJob }): React.JSX.Element {
  if (job.status === "queued" || job.status === "processing") {
    return <CancelButton job={job} />;
  }
  if (job.status === "complete") {
    return <FinishedMenu job={job} />;
  }
  return <RetryButton job={job} />;
}
