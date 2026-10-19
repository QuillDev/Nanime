import { RotateCcw } from "lucide-react";
import { useCallback, useState } from "react";
import type { PlaybackAuditEvent, PlaybackAuditOrigin } from "../types.ts";
import { usePlaybackHistory, useRestorePlaybackHistory } from "../hooks/usePlaybackHistory.ts";
import { useProfileEpisodes } from "../hooks/useProfileEpisodes.ts";
import { formatDuration } from "../format.ts";
import { episodeShortLabel, groupByDay, profileEpisode, type ProfileEpisodes } from "../lib/profileMedia.ts";
import { ProfileEmptyState, ProfileMediaRow, ProfileSection } from "./ProfileSection.tsx";

const RECENT_COUNT = 8;

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

function actionLabel(event: PlaybackAuditEvent): string {
  switch (event.action) {
    case "completed": {
      return "Finished";
    }
    case "playback-started": {
      return "Started";
    }
    case "playback-stopped": {
      return event.next === null ? "Stopped" : `Stopped at ${formatDuration(event.next.position)}`;
    }
    case "restored": {
      return "Restored an earlier state";
    }
    case "snapshot-imported": {
      return "Recorded existing state";
    }
    case "watched": {
      return "Marked watched";
    }
    case "unwatched": {
      return "Marked unwatched";
    }
  }
}

function isUndoable(event: PlaybackAuditEvent): boolean {
  return event.action === "completed" || event.action === "watched" || event.action === "unwatched";
}

function eventTime(event: PlaybackAuditEvent): string {
  return new Date(event.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function HistoryEvent({ episodes, event }: { readonly episodes: ProfileEpisodes; readonly event: PlaybackAuditEvent }): React.JSX.Element {
  const restore = useRestorePlaybackHistory();
  const handleRestore = useCallback(() => restore.mutate(event.id), [event.id, restore]);
  const episode = profileEpisode(episodes, event.rel);
  const label = episodeShortLabel(episode);
  return (
    <ProfileMediaRow rel={event.rel} thumbnail={episode.thumbnail}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm" title={event.rel}>
          <span className="font-medium">{episode.showTitle}</span>
          {label !== "" && <span className="text-muted-foreground"> {label}</span>}
        </p>
        <p className="truncate text-[13px] text-muted-foreground" title={`${new Date(event.createdAt).toLocaleString()} · ${originLabels[event.origin]}`}>
          {actionLabel(event)} · {eventTime(event)}
        </p>
        {restore.error !== null && (
          <p className="mt-1 select-text text-xs text-destructive">{restore.error.message}</p>
        )}
      </div>
      {isUndoable(event) && (
    <button
      type="button"
      onClick={handleRestore}
      disabled={restore.isPending}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
    >
      <RotateCcw className="size-3.5" />
      Undo
    </button>
      )}
    </ProfileMediaRow>
  );
}

function HistoryDays({ episodes, events }: { readonly episodes: ProfileEpisodes; readonly events: readonly PlaybackAuditEvent[] }): React.JSX.Element {
  return (
    <>
      {groupByDay(events).map((day) => (
        <section key={day.label} aria-label={day.label}>
          <h3 className="mb-1 mt-3 text-xs font-semibold text-muted-foreground first:mt-0">{day.label}</h3>
          <ul>
            {day.items.map((event) => <HistoryEvent key={event.id} episodes={episodes} event={event} />)}
          </ul>
        </section>
      ))}
    </>
  );
}

export function PlaybackHistory(): React.JSX.Element {
  const history = usePlaybackHistory();
  const episodes = useProfileEpisodes();
  const [showAll, setShowAll] = useState(false);
  const handleShowAll = useCallback(() => setShowAll(true), []);
  const events = history.data ?? [];
  const visible = showAll ? events : events.slice(0, RECENT_COUNT);
  return (
    <ProfileSection id="playback-history" title="History">
      {history.isPending && <ProfileEmptyState>Loading…</ProfileEmptyState>}
      {history.error !== null && (
        <p className="select-text py-2 text-sm text-destructive">{history.error.message}</p>
      )}
      {history.status === "success" && events.length === 0 && (
        <ProfileEmptyState>No playback changes yet.</ProfileEmptyState>
      )}
      {visible.length > 0 && <HistoryDays episodes={episodes} events={visible} />}
      {visible.length < events.length && (
        <button type="button" onClick={handleShowAll} className="mt-2 rounded-md py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Show older
        </button>
      )}
    </ProfileSection>
  );
}
