import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cancelTranscode } from "../api.ts";
import { formatRemaining, type SeasonTranscodeSummary } from "../lib/seasonTranscode.ts";
import { playbackReadinessKey } from "../hooks/usePlaybackReadiness.ts";
import { useStartTranscode, useTranscodes } from "../hooks/useTranscodes.ts";
import { cn } from "../lib/utils.ts";

interface SeasonTranscodeStatusProps {
  readonly summary: SeasonTranscodeSummary;
  readonly canTranscode: boolean;
}

function pathsNeedingTranscode(summary: SeasonTranscodeSummary): readonly string[] {
  return [...summary.episodes].flatMap(([path, state]) => (
    state.kind === "needs-transcode" || state.kind === "failed" ? [path] : []
  ));
}

function activePaths(summary: SeasonTranscodeSummary): ReadonlySet<string> {
  return new Set([...summary.episodes].flatMap(([path, state]) => (
    state.kind === "queued" || state.kind === "transcoding" ? [path] : []
  )));
}

function useSeasonTranscodeActions(summary: SeasonTranscodeSummary, canTranscode: boolean) {
  const client = useQueryClient();
  const start = useStartTranscode();
  const jobs = useTranscodes(canTranscode && summary.kind === "transcoding");
  const refresh = useCallback(() => client.invalidateQueries({ queryKey: playbackReadinessKey() }), [client]);
  const handleStart = useCallback(() => {
    start.mutate({ paths: pathsNeedingTranscode(summary), preset: "compatibility" }, { onSettled: refresh });
  }, [refresh, start, summary]);
  const handleCancel = useCallback(() => {
    const active = activePaths(summary);
    const ids = (jobs.data ?? []).flatMap((job) => (
      active.has(job.sourcePath) && (job.status === "queued" || job.status === "processing") ? [job.id] : []
    ));
    void (async (): Promise<void> => {
      await Promise.allSettled(ids.map((id) => cancelTranscode(id)));
      await refresh();
    })();
  }, [jobs.data, refresh, summary]);
  return { handleStart, handleCancel, starting: start.isPending, error: start.error };
}

function statusText(summary: SeasonTranscodeSummary): string {
  if (summary.kind === "needs-transcode") {
    return summary.ready === 0 ? "Needs transcoding" : "Some need transcoding";
  }
  return summary.remainingSeconds === null ? "Transcoding" : `Transcoding · ${formatRemaining(summary.remainingSeconds)} left`;
}

/** Season-level transcode state in plain words beside its action, right of the heading; nothing when every episode can play. */
export function SeasonTranscodeStatus({ summary, canTranscode }: SeasonTranscodeStatusProps): React.JSX.Element | null {
  const actions = useSeasonTranscodeActions(summary, canTranscode);
  if (summary.kind === "ready") {
    return null;
  }
  if (summary.kind === "loading") {
    // Most seasons turn out ready (no chip), so loading lays out like ready:
    // a placeholder chip wrapped the row on phones and then snapped back.
    return <span className="flex-1" />;
  }
  const needs = summary.kind === "needs-transcode";
  return (
    <>
      <span className="flex-1" />
      {/* Phones give the status and its action a line of their own under the heading. */}
      <span aria-hidden="true" className="order-last basis-full sm:hidden" />
      <output className={cn("max-sm:order-last max-sm:flex-1", needs ? "text-sm font-medium text-warning" : "text-sm tabular-nums text-muted-foreground")}>{statusText(summary)}</output>
      {canTranscode && needs && (
        <button type="button" disabled={actions.starting} onClick={actions.handleStart} className="h-10 rounded-full bg-warning px-5 max-sm:order-last text-sm font-semibold text-warning-foreground disabled:opacity-60">
          Transcode season
        </button>
      )}
      {canTranscode && !needs && (
        <button type="button" onClick={actions.handleCancel} className="h-10 rounded-full px-3 text-sm font-medium text-muted-foreground hover:text-foreground max-sm:order-last">
          Cancel
        </button>
      )}
      {actions.error !== null && <p role="alert" className="basis-full text-sm text-destructive">{actions.error.message}</p>}
    </>
  );
}
