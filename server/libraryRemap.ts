import type { LibraryMappingMovement } from "../shared/libraryFiles.ts";
import { database } from "./database.ts";
import { applyMappingMoves } from "./libraryMappings.ts";
import { baseName, hasInternalSegment, LibraryFileError, parentPath } from "./libraryPaths.ts";
import { recordPathMove } from "./mediaPathHistory.ts";

/** A top-level path change; everything inside a moved folder follows it. */
export interface PathMove {
  readonly from: string;
  readonly to: string;
  readonly folder: boolean;
}

interface CountRow {
  readonly count: number;
}

interface RelRow {
  readonly rel: string;
}

// `?1` is the path; matches the path itself and anything inside it.
const under = (column: string): string => `(${column} = ?1 OR substr(${column}, 1, length(?1) + 1) = ?1 || '/')`;
// Replaces the `?1` prefix with `?2`, preserving the remainder after it.
const rebased = (column: string): string => `?2 || substr(${column}, length(?1) + 1)`;

const STALE_CHECKS: readonly { readonly table: string; readonly column: string; readonly label: string }[] = [
  { table: "playback_progress", column: "rel", label: "saved watch progress" },
  { table: "transcode_jobs", column: "source_rel", label: "a transcode job" },
  { table: "offline_media_artifacts", column: "source_rel", label: "an offline copy" },
  { table: "watch_together", column: "rel", label: "a watch party" },
];
const staleQueries = STALE_CHECKS.map((check) => ({
  label: check.label,
  query: database.query<CountRow, [string]>(`SELECT COUNT(*) AS count FROM ${check.table} WHERE ${under(check.column)}`),
}));
const rebaseQueries = [
  ["playback_progress", "rel"],
  ["transcode_jobs", "source_rel"],
  ["offline_media_artifacts", "source_rel"],
  ["watch_together", "rel"],
  ["media_scans", "source_rel"],
  ["media_scan_tracks", "source_rel"],
].map(([table = "", column = ""]) => database.query<void, [string, string]>(
  `UPDATE ${table} SET ${column} = ${rebased(column)} WHERE ${under(column)}`,
));
const dropStaleScans = database.query<void, [string]>(`DELETE FROM media_scans WHERE ${under("source_rel")}`);
const dropStaleLibraryRows = database.query<void, [string]>(`DELETE FROM media_library WHERE ${under("rel")}`);
const libraryRowsUnder = database.query<RelRow, [string]>(`SELECT rel FROM media_library WHERE ${under("rel")}`);
const moveLibraryRow = database.query<void, [string, string, string, string]>(
  "UPDATE media_library SET rel = ?, name = ?, folder = ? WHERE rel = ?",
);

/**
 * Nanime still holds per-path state for something no longer on disk. Moving
 * different media onto that path would silently inherit it, so refuse.
 */
export function rejectStaleDestinations(moves: readonly PathMove[]): void {
  for (const move of moves) {
    for (const check of staleQueries) {
      if ((check.query.get(move.to)?.count ?? 0) > 0) {
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
    dropStaleLibraryRows.run(move.from);
    return;
  }
  dropStaleLibraryRows.run(move.to);
  for (const row of libraryRowsUnder.all(move.from)) {
    const rel = row.rel === move.from ? move.to : `${move.to}${row.rel.slice(move.from.length)}`;
    moveLibraryRow.run(rel, baseName(rel), parentPath(rel) ?? "", row.rel);
  }
}

export interface LibraryRemap {
  readonly operationId: string;
  readonly moves: readonly PathMove[];
  readonly mappings: readonly LibraryMappingMovement[];
  readonly now: number;
}

/**
 * Re-points every path-keyed record at the new paths. Must run inside the
 * transaction that commits the operation. The immutable playback audit log is
 * never rewritten; path history lets readers follow it instead.
 */
export function remapLibraryState(remap: LibraryRemap): void {
  const { operationId, moves, mappings, now } = remap;
  rejectStaleDestinations(moves);
  database.run("PRAGMA defer_foreign_keys = ON");
  for (const move of moves) {
    dropStaleScans.run(move.to);
    for (const query of rebaseQueries) {
      query.run(move.from, move.to);
    }
    moveLibraryRows(move);
    recordPathMove({ operationId, from: move.from, to: move.to, createdAt: now });
  }
  applyMappingMoves(mappings, now);
}
