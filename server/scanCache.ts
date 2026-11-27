import { lstat } from "node:fs/promises";
import { db, execute, MediaScanRowSchema, type MediaScanTrackRow, MediaScanTrackRowSchema, queryOne, queryRows } from "./database.ts";

export type TrackKind = MediaScanTrackRow["kind"];

const CachedScanSchema = MediaScanRowSchema.pick({ status: true, file_size: true, modified_at: true });
const TrackSizeSchema = MediaScanTrackRowSchema.pick({ stream_index: true, size_bytes: true });

export function invalidateMediaScan(rel: string): void {
  execute(db.deleteFrom("media_scans").where("source_rel", "=", rel));
}

export async function scannedTrackSizes(rel: string, abs: string, kind: TrackKind): Promise<ReadonlyMap<number, number>> {
  const row = queryOne(db.selectFrom("media_scans").select(["status", "file_size", "modified_at"]).where("source_rel", "=", rel), CachedScanSchema);
  const stats = row?.status === "complete" ? await lstat(abs).catch(() => null) : null;
  if (row === null || stats === null || row.file_size !== stats.size || row.modified_at !== Math.trunc(stats.mtimeMs)) {
    return new Map();
  }
  const tracks = queryRows(db.selectFrom("media_scan_tracks").select(["stream_index", "size_bytes"])
    .where("source_rel", "=", rel).where("kind", "=", kind), TrackSizeSchema);
  return new Map(tracks.map((track) => [track.stream_index, track.size_bytes]));
}
