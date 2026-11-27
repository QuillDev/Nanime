import type {
  PlaybackAuditAction,
  PlaybackAuditEvent,
  PlaybackAuditOrigin,
  PlaybackProgress,
} from "../shared/types.ts";
import { z } from "zod";
import { CountRowSchema, database, db, execute, type PlaybackAuditRow, PlaybackAuditRowSchema, PlaybackProgressRowSchema, queryOne, queryRows, sql } from "./database.ts";
import { hasInternalSegment } from "./libraryPaths.ts";
import { mediaAuditWindows } from "./mediaPathHistory.ts";

export interface PlaybackActor {
  readonly id: number;
  readonly username: string;
}

const PlaybackRowSchema = PlaybackProgressRowSchema.omit({ user_id: true });
type PlaybackRow = z.infer<typeof PlaybackRowSchema>;
type AuditRow = PlaybackAuditRow;
const SnapshotRowSchema = PlaybackProgressRowSchema.extend({ username: z.string() });
const OwnerRowSchema = PlaybackProgressRowSchema.pick({ user_id: true, rel: true });
const PLAYBACK_COLUMNS = ["rel", "position", "duration", "completed", "updated_at", "dismissed_at"] as const;

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

function auditRows() {
  return db.selectFrom("playback_audit_log").selectAll();
}

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
    execute(db.deleteFrom("playback_progress").where("user_id", "=", userId).where("rel", "=", rel));
    return;
  }
  const state = {
    position: next.position,
    duration: next.duration,
    completed: next.completed ? 1 : 0,
    updated_at: next.updatedAt,
    dismissed_at: next.dismissedAt,
  };
  execute(db.insertInto("playback_progress").values({ user_id: userId, rel, ...state })
    .onConflict((conflict) => conflict.columns(["user_id", "rel"]).doUpdateSet(state)));
}

const commitMutation = database.transaction((mutation: PlaybackMutation) => {
  const row = queryOne(db.selectFrom("playback_progress").select(PLAYBACK_COLUMNS)
    .where("user_id", "=", mutation.userId).where("rel", "=", mutation.rel), PlaybackRowSchema);
  const previous = row === null ? null : playbackFromRow(row);
  const next = mutation.next(previous);
  writeState(mutation.userId, mutation.rel, next);
  const createdAt = Date.now();
  if (mutation.recordAudit !== false) {
    execute(db.insertInto("playback_audit_log").values({
      user_id: mutation.userId,
      actor_user_id: mutation.actor?.id ?? null,
      actor_username: mutation.actor?.username ?? "System",
      rel: mutation.rel,
      action: mutation.action,
      origin: mutation.origin,
      previous_state: storedState(previous),
      next_state: storedState(next),
      anilist_media_id: mutation.anilistTarget?.mediaId ?? null,
      episode: mutation.anilistTarget?.episode ?? null,
      total_episodes: mutation.anilistTarget?.totalEpisodes ?? null,
      session_seconds: mutation.sessionSeconds ?? null,
      reverts_event_id: mutation.revertsEventId ?? null,
      created_at: createdAt,
    }));
  }
  return next;
});

const importExistingSnapshots = database.transaction(() => {
  if (queryOne(sql`SELECT COUNT(*) AS count FROM playback_audit_log`, CountRowSchema)?.count !== 0) {
    return;
  }
  const snapshots = queryRows(sql`
    SELECT progress.user_id, users.username, progress.rel, progress.position,
      progress.duration, progress.completed, progress.updated_at, progress.dismissed_at
    FROM playback_progress AS progress
    JOIN users ON users.id = progress.user_id
  `, SnapshotRowSchema);
  for (const row of snapshots) {
    const progress = playbackFromRow(row);
    execute(db.insertInto("playback_audit_log").values({
      user_id: row.user_id,
      actor_user_id: row.user_id,
      actor_username: row.username,
      rel: row.rel,
      action: "snapshot-imported",
      origin: "migration",
      previous_state: null,
      next_state: storedState(progress),
      anilist_media_id: null,
      episode: null,
      total_episodes: null,
      session_seconds: null,
      reverts_event_id: null,
      created_at: Date.now(),
    }));
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
  const rows = queryRows(db.selectFrom("playback_progress").select(PLAYBACK_COLUMNS)
    .where("user_id", "=", userId).orderBy("updated_at", "desc"), PlaybackRowSchema);
  return rows.flatMap((row) => (hasInternalSegment(row.rel) ? [] : [playbackFromRow(row)]));
}

export function playbackAuditForUser(
  userId: number,
  limit: number,
  rel: string | null,
): readonly PlaybackAuditEvent[] {
  if (rel === null) {
    const rows = queryRows(auditRows().where("user_id", "=", userId)
      .orderBy("created_at", "desc").orderBy("id", "desc").limit(limit), PlaybackAuditRowSchema);
    return rows.map((row) => eventFromRow(row));
  }
  // Moves never rewrite the immutable log; include events recorded under the
  // paths this media had before it was renamed or moved, and only while it
  // was the media at each of those paths.
  const rows = mediaAuditWindows(rel).flatMap((window) => queryRows(auditRows()
    .where("user_id", "=", userId).where("rel", "=", window.rel)
    .where("id", ">", window.afterId).where("id", "<=", window.throughId ?? Number.MAX_SAFE_INTEGER)
    .orderBy("id", "desc").limit(limit), PlaybackAuditRowSchema));
  return rows
    .toSorted((a, b) => b.created_at - a.created_at || b.id - a.id)
    .slice(0, limit)
    .map((row) => eventFromRow(row));
}

export function playbackAuditEvent(userId: number, id: number): PlaybackAuditEvent | null {
  const row = queryOne(auditRows().where("id", "=", id).where("user_id", "=", userId), PlaybackAuditRowSchema);
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
    for (const owner of queryRows(db.selectFrom("playback_progress").select(["user_id", "rel"]).where("rel", "=", rel), OwnerRowSchema)) {
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
