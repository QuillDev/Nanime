import { CountRowSchema, database, execute, MediaLibraryRowSchema, queryOne, queryRows, sql } from "./database.ts";
import { baseName, hasInternalSegment, LibraryFileError, parentPath } from "./libraryPaths.ts";
import { recordPathMove } from "./mediaPathHistory.ts";

/** A top-level path change; everything inside a moved folder follows it. */
export interface PathMove {
  readonly from: string;
  readonly to: string;
  readonly folder: boolean;
}

const RelSchema = MediaLibraryRowSchema.pick({ rel: true });

// Matches `path` itself and anything inside it.
function under(column: string, path: string) {
  const ref = sql.ref(column);
  return sql`(${ref} = ${path} OR substr(${ref}, 1, length(${path}) + 1) = ${path} || '/')`;
}

const STALE_CHECKS: readonly { readonly table: string; readonly column: string; readonly label: string }[] = [
  { table: "playback_progress", column: "rel", label: "saved watch progress" },
  { table: "transcode_jobs", column: "source_rel", label: "a transcode job" },
  { table: "offline_media_artifacts", column: "source_rel", label: "an offline copy" },
  { table: "watch_together", column: "rel", label: "a watch party" },
];
const REBASED_COLUMNS = [
  ["playback_progress", "rel"],
  ["transcode_jobs", "source_rel"],
  ["offline_media_artifacts", "source_rel"],
  ["watch_together", "rel"],
  ["media_scans", "source_rel"],
  ["media_scan_tracks", "source_rel"],
] as const;

function staleCount(table: string, column: string, path: string): number {
  return queryOne(sql`SELECT COUNT(*) AS count FROM ${sql.table(table)} WHERE ${under(column, path)}`, CountRowSchema)?.count ?? 0;
}

// Replaces the `from` prefix with `to`, preserving the remainder after it.
function rebase(table: string, column: string, move: PathMove): void {
  const ref = sql.ref(column);
  execute(sql`UPDATE ${sql.table(table)} SET ${ref} = ${move.to} || substr(${ref}, length(${move.from}) + 1) WHERE ${under(column, move.from)}`);
}

function dropLibraryRows(path: string): void {
  execute(sql`DELETE FROM media_library WHERE ${under("rel", path)}`);
}

/**
 * Nanime still holds per-path state for something no longer on disk. Moving
 * different media onto that path would silently inherit it, so refuse.
 */
export function rejectStaleDestinations(moves: readonly PathMove[]): void {
  for (const move of moves) {
    for (const check of STALE_CHECKS) {
      if (staleCount(check.table, check.column, move.to) > 0) {
        throw new LibraryFileError(409, `Nanime still has ${check.label} recorded for a missing item at “${move.to}”. Choose a different name or location.`);
      }
    }
  }
}

/**
 * Cached library rows follow a move. Rows moving into Nanime's trash are
 * dropped instead, in the same transaction, so trashed media never appears in
 * `/api/list`; Undo brings them back through the follow-up scan.
 */
function moveLibraryRows(move: PathMove): void {
  if (hasInternalSegment(move.to)) {
    dropLibraryRows(move.from);
    return;
  }
  dropLibraryRows(move.to);
  for (const row of queryRows(sql`SELECT rel FROM media_library WHERE ${under("rel", move.from)}`, RelSchema)) {
    const rel = row.rel === move.from ? move.to : `${move.to}${row.rel.slice(move.from.length)}`;
    execute(sql`UPDATE media_library SET rel = ${rel}, name = ${baseName(rel)}, folder = ${parentPath(rel) ?? ""} WHERE rel = ${row.rel}`);
  }
}

export interface LibraryRemap {
  readonly operationId: string;
  readonly moves: readonly PathMove[];
  readonly now: number;
}

/**
 * Re-points every path-keyed record at the new paths. Must run inside the
 * transaction that commits the operation. The immutable playback audit log is
 * never rewritten; path history lets readers follow it instead.
 */
export function remapLibraryState(remap: LibraryRemap): void {
  const { operationId, moves, now } = remap;
  rejectStaleDestinations(moves);
  database.run("PRAGMA defer_foreign_keys = ON");
  for (const move of moves) {
    execute(sql`DELETE FROM media_scans WHERE ${under("source_rel", move.to)}`);
    for (const [table, column] of REBASED_COLUMNS) {
      rebase(table, column, move);
    }
    moveLibraryRows(move);
    recordPathMove({ operationId, from: move.from, to: move.to, createdAt: now });
  }
}
