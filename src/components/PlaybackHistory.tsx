import { History, RotateCcw } from "lucide-react";
import { useCallback } from "react";
import type { PlaybackAuditEvent, PlaybackAuditOrigin, PlaybackProgress } from "../types.ts";
import { usePlaybackHistory, useRestorePlaybackHistory } from "../hooks/usePlaybackHistory.ts";
import { formatDuration } from "../format.ts";

const actionLabels = {
  completed: "Finished watching",
  "playback-started": "Started watching",
  "playback-stopped": "Stopped watching",
  restored: "Restored an earlier state",
  "snapshot-imported": "Recorded existing state",
  watched: "Marked watched",
  unwatched: "Marked unwatched",
} as const;

const originLabels = {
  "episode-menu": "episode menu",
  history: "playback history",
  home: "home screen",
  "media-library": "media library",
  migration: "audit setup",
  player: "player",
  "season-menu": "season menu",
  "series-menu": "series menu",
} as const satisfies Readonly<Record<PlaybackAuditOrigin, string>>;

function mediaName(rel: string): string {
  return rel.split("/").at(-1) ?? rel;
}

function playbackSummary(progress: PlaybackProgress | null): string {
  if (progress === null) {
    return "No saved state";
  }
  if (progress.completed) {
    return "Watched";
  }
  const percent = progress.duration > 0
    ? Math.round(progress.position / progress.duration * 100)
    : 0;
  const position = `${formatDuration(progress.position)} / ${formatDuration(progress.duration)}`;
  return `${position} · ${String(percent)}%${progress.dismissedAt === null ? "" : " · hidden from home"}`;
}

function HistoryEvent({ event }: { readonly event: PlaybackAuditEvent }): React.JSX.Element {
  const restore = useRestorePlaybackHistory();
  const handleRestore = useCallback(() => restore.mutate(event.id), [event.id, restore]);
  return (
    <li className="border-b border-border py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">{actionLabels[event.action]}</p>
          <p className="mt-1 truncate text-sm text-muted-foreground" title={event.rel}>
            {mediaName(event.rel)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {playbackSummary(event.previous)} → {playbackSummary(event.next)}
          </p>
          {event.sessionSeconds !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              Session duration: {formatDuration(event.sessionSeconds)}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {new Date(event.createdAt).toLocaleString()} · {originLabels[event.origin]} · {event.actorUsername}
          </p>
        </div>
        {(event.action === "completed" || event.action === "watched" || event.action === "unwatched") && (
          <button
            type="button"
            onClick={handleRestore}
            disabled={restore.isPending}
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground hover:bg-accent disabled:text-muted-foreground"
          >
            <RotateCcw className="size-3.5" />
            Restore previous
          </button>
        )}
      </div>
      {restore.error !== null && (
        <p className="mt-2 select-text text-xs text-destructive">{restore.error.message}</p>
      )}
    </li>
  );
}

export function PlaybackHistory(): React.JSX.Element {
  const history = usePlaybackHistory();
  const events = history.data ?? [];
  return (
    <section className="border-b border-border py-6" aria-labelledby="playback-history-title">
      <div className="flex items-center gap-2">
        <History className="size-5 text-primary" />
        <h2 id="playback-history-title" className="text-lg font-semibold">Playback history</h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Watched-state changes are retained permanently. Restoring creates another history entry.
      </p>
      {history.isPending && <p className="py-5 text-sm text-muted-foreground">Loading history…</p>}
      {history.error !== null && (
        <p className="py-5 select-text text-sm text-destructive">{history.error.message}</p>
      )}
      {history.status === "success" && events.length === 0 && (
        <p className="py-5 text-sm text-muted-foreground">No playback actions recorded yet.</p>
      )}
      {events.length > 0 && (
        <ul className="mt-3">
          {events.map((event) => <HistoryEvent key={event.id} event={event} />)}
        </ul>
      )}
    </section>
  );
}
