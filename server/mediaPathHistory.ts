import { z } from "zod";
import { execute, MediaPathHistoryRowSchema, queryOne, queryRows, sql } from "./database.ts";

/**
 * Path history records each committed move of a library path. Playback audit
 * entries stay keyed by the path they were recorded at and are never
 * rewritten; this history tells which audit entries belong to which occupant
 * of a path.
 *
 * Each move stores an audit watermark: the newest playback audit id when the
 * move committed. Audit entries at or below it were recorded before the move
 * and above it after, so attribution never depends on timestamps that can
 * tie. Moves are ordered by id, and every walk below strictly advances or
 * retreats through those ids, so it always terminates without a hop limit.
 */

const HistoryRowSchema = MediaPathHistoryRowSchema.pick({ id: true, old_rel: true, new_rel: true }).extend({ watermark: z.number() });
type HistoryRow = z.infer<typeof HistoryRowSchema>;

// Rows from before watermarks were stored fall back to the newest audit entry
// strictly older than the move, which errs toward the earlier occupant only on
// an exact timestamp tie.
const HISTORY_COLUMNS = sql`id, old_rel, new_rel, COALESCE(audit_watermark, (
  SELECT COALESCE(MAX(audit.id), 0) FROM playback_audit_log AS audit WHERE audit.created_at < history.created_at
)) AS watermark`;
// The column matches when it is `path` or a folder containing it.
function covers(column: string, path: string) {
  const ref = sql.ref(column);
  return sql`(${ref} = ${path} OR substr(${path}, 1, length(${ref}) + 1) = ${ref} || '/')`;
}
function touching(path: string) {
  return sql`(${covers("old_rel", path)} OR ${covers("new_rel", path)})`;
}

function latestTouchingBefore(path: string, beforeId: number): HistoryRow | null {
  return queryOne(sql`
    SELECT ${HISTORY_COLUMNS} FROM media_path_history AS history
    WHERE id < ${beforeId} AND ${touching(path)}
    ORDER BY id DESC LIMIT 1
  `, HistoryRowSchema);
}
function nextTouchingAfter(path: string, afterId: number): HistoryRow | null {
  return queryOne(sql`
    SELECT ${HISTORY_COLUMNS} FROM media_path_history AS history
    WHERE id > ${afterId} AND ${touching(path)}
    ORDER BY id LIMIT 1
  `, HistoryRowSchema);
}
function firstTouchingFromWatermark(path: string, auditId: number): HistoryRow | null {
  return queryOne(sql`
    SELECT * FROM (SELECT ${HISTORY_COLUMNS} FROM media_path_history AS history
      WHERE ${covers("old_rel", path)} OR ${covers("new_rel", path)})
    WHERE watermark >= ${auditId}
    ORDER BY id LIMIT 1
  `, HistoryRowSchema);
}
function movesAwayFrom(path: string): readonly HistoryRow[] {
  return queryRows(sql`
    SELECT ${HISTORY_COLUMNS} FROM media_path_history AS history
    WHERE ${covers("old_rel", path)}
    ORDER BY id
  `, HistoryRowSchema);
}

export interface PathHistoryEntry {
  readonly operationId: string;
  readonly from: string;
  readonly to: string;
  readonly createdAt: number;
}

/** Records a committed move. Runs inside the operation's commit transaction. */
export function recordPathMove(entry: PathHistoryEntry): void {
  execute(sql`
    INSERT INTO media_path_history (operation_id, old_rel, new_rel, created_at, audit_watermark)
    VALUES (${entry.operationId}, ${entry.from}, ${entry.to}, ${entry.createdAt}, (SELECT COALESCE(MAX(id), 0) FROM playback_audit_log))
  `);
}

function covered(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/** The row moved whatever was at `path` into place (rather than away from it). */
function arrivedBy(row: HistoryRow, path: string): boolean {
  return covered(path, row.new_rel);
}

function rebase(path: string, from: string, to: string): string {
  return `${to}${path.slice(from.length)}`;
}

/** Follows the entry that just left `path` via `row` until it stops moving. */
function followForward(path: string, row: HistoryRow): string | null {
  let current = rebase(path, row.old_rel, row.new_rel);
  let afterId = row.id;
  for (;;) {
    const next = nextTouchingAfter(current, afterId);
    if (next === null) {
      return current;
    }
    // Something arrived where our entry should still be: it left in a way
    // Nanime didn't record, so where it went is unknown.
    if (arrivedBy(next, current)) {
      return null;
    }
    current = rebase(current, next.old_rel, next.new_rel);
    afterId = next.id;
  }
}

/**
 * Where the media that audit entry `auditId` was recorded for (at `rel`)
 * lives now, or null when that can't be determined. The path itself is the
 * answer only if nothing has moved through it since.
 */
export function currentMediaPathForAudit(rel: string, auditId: number): string | null {
  const row = firstTouchingFromWatermark(rel, auditId);
  if (row === null) {
    return rel;
  }
  return arrivedBy(row, rel) ? null : followForward(rel, row);
}

/** Candidate destinations of departed occupants; callers must validate identity. */
export function departedMediaPaths(rel: string): readonly (string | null)[] {
  return movesAwayFrom(rel).map((row) => followForward(rel, row));
}

/** A missing path's sole recorded departure, or null for ambiguous legacy replay. */
export function currentMediaPath(rel: string): string | null {
  const departures = departedMediaPaths(rel);
  // Path-only replay cannot choose between distinct departed occupants.
  return departures.length === 1 ? departures[0] ?? null : null;
}

/** Audit entries recorded at `rel` with ids in `(afterId, throughId]` belong to the media. */
export interface AuditWindow {
  readonly rel: string;
  readonly afterId: number;
  readonly throughId: number | null;
}

/**
 * The audit windows that belong to whatever is at `rel` now, newest first:
 * its current path since it arrived, then each earlier path it was moved
 * from, bounded by when it arrived there and when it left. Entries for
 * previous occupants of any of those paths fall outside every window.
 */
export function mediaAuditWindows(rel: string): readonly AuditWindow[] {
  const windows: AuditWindow[] = [];
  let path = rel;
  let throughId: number | null = null;
  let beforeId = Number.MAX_SAFE_INTEGER;
  for (;;) {
    const row = latestTouchingBefore(path, beforeId);
    windows.push({ rel: path, afterId: row?.watermark ?? 0, throughId });
    if (row === null || !arrivedBy(row, path)) {
      // No earlier record, or the previous occupant left and this media
      // arrived in a way Nanime didn't record: its history starts here.
      return windows;
    }
    path = rebase(path, row.new_rel, row.old_rel);
    throughId = row.watermark;
    beforeId = row.id;
  }
}
