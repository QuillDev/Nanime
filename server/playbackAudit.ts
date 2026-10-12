import type {
  PlaybackAuditAction,
  PlaybackAuditEvent,
  PlaybackAuditOrigin,
  PlaybackProgress,
} from "../shared/types.ts";
import { database } from "./database.ts";
import { hasInternalSegment } from "./libraryPaths.ts";
import { mediaAuditWindows } from "./mediaPathHistory.ts";

export interface PlaybackActor {
  readonly id: number;
  readonly username: string;
}

interface PlaybackRow {
  readonly rel: string;
  readonly position: number;
  readonly duration: number;
  readonly completed: number;
  readonly updated_at: number;
  readonly dismissed_at: number | null;
}

interface AuditRow {
  readonly id: number;
  readonly user_id: number;
  readonly actor_user_id: number | null;
  readonly actor_username: string;
  readonly rel: string;
  readonly action: PlaybackAuditAction;
  readonly origin: PlaybackAuditOrigin;
  readonly previous_state: string | null;
  readonly next_state: string | null;
  readonly anilist_media_id: number | null;
  readonly episode: number | null;
  readonly total_episodes: number | null;
  readonly session_seconds: number | null;
  readonly reverts_event_id: number | null;
  readonly created_at: number;
}

interface PlaybackMutation {
  readonly userId: number;
  readonly actor: PlaybackActor | null;
  readonly rel: string;
  readonly action: PlaybackAuditAction;
  readonly origin: PlaybackAuditOrigin;
  readonly revertsEventId?: number | null;
  readonly sessionSeconds?: number | null;
  readonly recordAudit?: boolean;
  readonly anilistTarget?: {
    readonly mediaId: number;
    readonly episode: number;
    readonly totalEpisodes: number | null;
  } | null;
  readonly next: (previous: PlaybackProgress | null) => PlaybackProgress | null;
}

const listProgress = database.query<PlaybackRow, [number]>(`
  SELECT rel, position, duration, completed, updated_at, dismissed_at
  FROM playback_progress
  WHERE user_id = ?
  ORDER BY updated_at DESC
`);
const getProgress = database.query<PlaybackRow, [number, string]>(`
  SELECT rel, position, duration, completed, updated_at, dismissed_at
  FROM playback_progress
  WHERE user_id = ? AND rel = ?
`);
const upsertProgress = database.query<void, [number, string, number, number, number, number, number | null]>(`
  INSERT INTO playback_progress (
    user_id, rel, position, duration, completed, updated_at, dismissed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, rel) DO UPDATE SET
    position = excluded.position,
    duration = excluded.duration,
    completed = excluded.completed,
    updated_at = excluded.updated_at,
    dismissed_at = excluded.dismissed_at
`);
const deleteProgress = database.query<void, [number, string]>(`
  DELETE FROM playback_progress WHERE user_id = ? AND rel = ?
`);
const insertAudit = database.query<void, [
  number, number | null, string, string, PlaybackAuditAction, PlaybackAuditOrigin,
  string | null, string | null, number | null, number | null, number | null, number | null,
  number | null, number,
]>(`
  INSERT INTO playback_audit_log (
    user_id, actor_user_id, actor_username, rel, action, origin,
    previous_state, next_state, anilist_media_id, episode, total_episodes,
    session_seconds, reverts_event_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const listAudit = database.query<AuditRow, [number, number]>(`
  SELECT id, user_id, actor_user_id, actor_username, rel, action, origin,
    previous_state, next_state, anilist_media_id, episode, total_episodes, session_seconds,
    reverts_event_id, created_at
  FROM playback_audit_log
  WHERE user_id = ?
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);
const listAuditInWindow = database.query<AuditRow, [number, string, number, number, number]>(`
  SELECT id, user_id, actor_user_id, actor_username, rel, action, origin,
    previous_state, next_state, anilist_media_id, episode, total_episodes, session_seconds,
    reverts_event_id, created_at
  FROM playback_audit_log
  WHERE user_id = ? AND rel = ? AND id > ? AND id <= ?
  ORDER BY id DESC
  LIMIT ?
`);
const getAudit = database.query<AuditRow, [number, number]>(`
  SELECT id, user_id, actor_user_id, actor_username, rel, action, origin,
    previous_state, next_state, anilist_media_id, episode, total_episodes, session_seconds,
    reverts_event_id, created_at
  FROM playback_audit_log
  WHERE id = ? AND user_id = ?
`);
const auditCount = database.query<{ readonly count: number }, []>(`
  SELECT COUNT(*) AS count FROM playback_audit_log
`);
const playbackSnapshots = database.query<PlaybackRow & {
  readonly user_id: number;
  readonly username: string;
}, []>(`
  SELECT progress.user_id, users.username, progress.rel, progress.position,
    progress.duration, progress.completed, progress.updated_at, progress.dismissed_at
  FROM playback_progress AS progress
  JOIN users ON users.id = progress.user_id
`);
const progressOwnersForMedia = database.query<{
  readonly user_id: number;
  readonly rel: string;
}, [string]>(`
  SELECT user_id, rel FROM playback_progress WHERE rel = ?
`);

export function playbackFromRow(row: PlaybackRow): PlaybackProgress {
  return {
    rel: row.rel,
    position: row.position,
    duration: row.duration,
    completed: row.completed === 1,
    updatedAt: row.updated_at,
    dismissedAt: row.dismissed_at,
  };
}

function storedState(progress: PlaybackProgress | null): string | null {
  return progress === null ? null : JSON.stringify(progress);
}

function parsedState(value: string | null): PlaybackProgress | null {
  return value === null ? null : JSON.parse(value) as PlaybackProgress;
}

function eventFromRow(row: AuditRow): PlaybackAuditEvent {
  return {
    id: row.id,
    userId: row.user_id,
    actorUserId: row.actor_user_id,
    actorUsername: row.actor_username,
    rel: row.rel,
    action: row.action,
    origin: row.origin,
    previous: parsedState(row.previous_state),
    next: parsedState(row.next_state),
    anilistMediaId: row.anilist_media_id,
    episode: row.episode,
    totalEpisodes: row.total_episodes,
    sessionSeconds: row.session_seconds,
    revertsEventId: row.reverts_event_id,
    createdAt: row.created_at,
  };
}

function writeState(userId: number, rel: string, next: PlaybackProgress | null): void {
  if (next === null) {
    deleteProgress.run(userId, rel);
    return;
  }
  upsertProgress.run(
    userId,
    rel,
    next.position,
    next.duration,
    next.completed ? 1 : 0,
    next.updatedAt,
    next.dismissedAt,
  );
}

const commitMutation = database.transaction((mutation: PlaybackMutation) => {
  const row = getProgress.get(mutation.userId, mutation.rel);
  const previous = row === null ? null : playbackFromRow(row);
  const next = mutation.next(previous);
  writeState(mutation.userId, mutation.rel, next);
  const createdAt = Date.now();
  if (mutation.recordAudit !== false) {
    insertAudit.run(
      mutation.userId,
      mutation.actor?.id ?? null,
      mutation.actor?.username ?? "System",
      mutation.rel,
      mutation.action,
      mutation.origin,
      storedState(previous),
      storedState(next),
      mutation.anilistTarget?.mediaId ?? null,
      mutation.anilistTarget?.episode ?? null,
      mutation.anilistTarget?.totalEpisodes ?? null,
      mutation.sessionSeconds ?? null,
      mutation.revertsEventId ?? null,
      createdAt,
    );
  }
  return next;
});

const importExistingSnapshots = database.transaction(() => {
  if (auditCount.get()?.count !== 0) {
    return;
  }
  for (const row of playbackSnapshots.all()) {
    const progress = playbackFromRow(row);
    insertAudit.run(
      row.user_id,
      row.user_id,
      row.username,
      row.rel,
      "snapshot-imported",
      "migration",
      null,
      storedState(progress),
      null,
      null,
      null,
      null,
      null,
      Date.now(),
    );
  }
});

importExistingSnapshots();

export function mutatePlayback(mutation: PlaybackMutation): PlaybackProgress | null {
  return commitMutation(mutation);
}

/**
 * Progress for media in Nanime's own folders (trashed media awaiting Undo) is
 * kept so Undo restores it, but never offered for playback.
 */
export function playbackProgressForUser(userId: number): readonly PlaybackProgress[] {
  return listProgress.all(userId).flatMap((row) => (hasInternalSegment(row.rel) ? [] : [playbackFromRow(row)]));
}

export function playbackAuditForUser(
  userId: number,
  limit: number,
  rel: string | null,
): readonly PlaybackAuditEvent[] {
  if (rel === null) {
    return listAudit.all(userId, limit).map((row) => eventFromRow(row));
  }
  // Moves never rewrite the immutable log; include events recorded under the
  // paths this media had before it was renamed or moved, and only while it
  // was the media at each of those paths.
  const rows = mediaAuditWindows(rel).flatMap((window) => listAuditInWindow.all(
    userId, window.rel, window.afterId, window.throughId ?? Number.MAX_SAFE_INTEGER, limit,
  ));
  return rows
    .toSorted((a, b) => b.created_at - a.created_at || b.id - a.id)
    .slice(0, limit)
    .map((row) => eventFromRow(row));
}

export function playbackAuditEvent(userId: number, id: number): PlaybackAuditEvent | null {
  const row = getAudit.get(id, userId);
  return row === null ? null : eventFromRow(row);
}

/** Restores the state before `event` onto `rel`, where that media lives now. */
export function restorePlaybackAuditEvent(
  event: PlaybackAuditEvent,
  actor: PlaybackActor,
  rel: string = event.rel,
): PlaybackProgress | null {
  return mutatePlayback({
    userId: event.userId,
    actor,
    rel,
    action: "restored",
    origin: "history",
    revertsEventId: event.id,
    sessionSeconds: null,
    anilistTarget: event.anilistMediaId === null || event.episode === null
      ? null
      : {
        mediaId: event.anilistMediaId,
        episode: event.episode,
        totalEpisodes: event.totalEpisodes,
      },
    next: () => event.previous === null
      ? null
      : { ...event.previous, rel, updatedAt: Date.now() },
  });
}

export function removePlaybackForMedia(
  rels: readonly string[],
  actor: PlaybackActor | null,
): void {
  for (const rel of rels) {
    for (const owner of progressOwnersForMedia.all(rel)) {
      mutatePlayback({
        userId: owner.user_id,
        actor,
        rel: owner.rel,
        action: "playback-stopped",
        origin: "media-library",
        recordAudit: false,
        next: () => null,
      });
    }
  }
}
