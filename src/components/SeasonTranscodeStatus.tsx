import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cancelTranscode } from "../api.ts";
import { formatRemaining, type SeasonTranscodeSummary } from "../lib/seasonTranscode.ts";
import { playbackReadinessKey } from "../hooks/usePlaybackReadiness.ts";
import { useStartTranscode, useTranscodes } from "../hooks/useTranscodes.ts";

interface SeasonTranscodeStatusProps {
  readonly summary: SeasonTranscodeSummary;
  readonly canTranscode: boolean;
}

const RING_RADIUS = 7;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function ProgressRing({ ratio }: { readonly ratio: number }): React.JSX.Element {
  const filled = Math.min(1, Math.max(0, ratio)) * RING_LENGTH;
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" className="size-[18px] shrink-0 -rotate-90">
      <circle cx="9" cy="9" r={RING_RADIUS} fill="none" strokeWidth="3" className="stroke-white/15" />
      <circle cx="9" cy="9" r={RING_RADIUS} fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-primary" strokeDasharray={`${String(filled)} ${String(RING_LENGTH)}`} />
    </svg>
  );
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

function chipText(summary: SeasonTranscodeSummary): string {
  if (summary.kind === "needs-transcode") {
    const missing = summary.total - summary.ready;
    return summary.ready === 0 ? "Needs transcoding to play" : `${String(missing)} more need transcoding`;
  }
  const left = summary.remainingSeconds === null ? "" : ` · ${formatRemaining(summary.remainingSeconds)} left`;
  return `${String(summary.ready)} of ${String(summary.total)} ready${left}`;
}

/** Season-level transcode state beside the Episodes heading; nothing when every episode can play. */
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
      <output
        className={needs
          ? "inline-flex h-9 items-center gap-2.5 rounded-full bg-warning/10 px-3.5 text-sm font-medium text-warning ring-1 ring-inset ring-warning/35"
          : "inline-flex h-9 items-center gap-2.5 rounded-full bg-primary/12 px-3.5 text-sm font-medium tabular-nums"}
      >
        {needs ? <span aria-hidden="true" className="size-2 rounded-full bg-warning" /> : <ProgressRing ratio={summary.ready / Math.max(1, summary.total)} />}
        {chipText(summary)}
      </output>
      <span className="flex-1" />
      {canTranscode && needs && (
        <button type="button" disabled={actions.starting} onClick={actions.handleStart} className="h-10 rounded-full bg-warning px-5 text-sm font-semibold text-warning-foreground disabled:opacity-60">
          Transcode season
        </button>
      )}
      {canTranscode && !needs && (
        <button type="button" onClick={actions.handleCancel} className="h-10 rounded-full px-3 text-sm font-medium text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      )}
      {actions.error !== null && <p role="alert" className="basis-full text-sm text-destructive">{actions.error.message}</p>}
    </>
  );
}
