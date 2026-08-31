import { History, RotateCcw } from "lucide-react";
import { useCallback } from "react";
import type { PlaybackAuditEvent, PlaybackAuditOrigin, PlaybackProgress } from "../types.ts";
import { usePlaybackHistory, useRestorePlaybackHistory } from "../hooks/usePlaybackHistory.ts";
import { formatDuration } from "../format.ts";
import { ProfileEmptyState, ProfileSection } from "./ProfileSection.tsx";

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
    <li className="px-4 py-4 sm:px-5">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-4">
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
            {new Date(event.createdAt).toLocaleString()} · {originLabels[event.origin]}
          </p>
        </div>
        {(event.action === "completed" || event.action === "watched" || event.action === "unwatched") && (
          <button
            type="button"
            onClick={handleRestore}
            disabled={restore.isPending}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-secondary px-2.5 text-xs font-medium text-secondary-foreground hover:bg-accent disabled:text-muted-foreground"
          >
            <RotateCcw className="size-3.5" />
            Undo
          </button>
        )}
      </div>
      {restore.error !== null && (
        <p className="mt-2 select-text text-xs text-destructive">{restore.error.message}</p>
      )}
    </li>
  );
}

function HistoryList({ events }: { readonly events: readonly PlaybackAuditEvent[] }): React.JSX.Element {
  return (
    <ul className="divide-y divide-border">
      {events.map((event) => <HistoryEvent key={event.id} event={event} />)}
    </ul>
  );
}

export function PlaybackHistory({ className }: { readonly className?: string }): React.JSX.Element {
  const history = usePlaybackHistory();
  const events = history.data ?? [];
  const recent = events.slice(0, 5);
  const older = events.slice(5);
  return (
    <ProfileSection
      className={className}
      description="Recent watched-state changes."
      icon={History}
      id="playback-history-title"
      title="Playback history"
    >
      {history.isPending && <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">Loading…</p>}
      {history.error !== null && (
        <p className="select-text px-4 py-6 text-sm text-destructive sm:px-5">{history.error.message}</p>
      )}
      {history.status === "success" && events.length === 0 && (
        <ProfileEmptyState>No playback changes yet.</ProfileEmptyState>
      )}
      {events.length > 0 && (
        <>
          <HistoryList events={recent} />
          {older.length > 0 && (
            <details className="group border-t border-border">
              <summary className="cursor-pointer px-4 py-3 text-center text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground sm:px-5">
                Show {older.length} older {older.length === 1 ? "change" : "changes"}
              </summary>
              <HistoryList events={older} />
            </details>
          )}
        </>
      )}
    </ProfileSection>
  );
}
