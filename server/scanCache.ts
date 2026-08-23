import { lstat } from "node:fs/promises";
import { database } from "./database.ts";

export type TrackKind = "audio" | "subtitle";

interface CachedScan {
  readonly status: string;
  readonly file_size: number;
  readonly modified_at: number;
}

const scanByPath = database.query<CachedScan, [string]>(`
  SELECT status, file_size, modified_at FROM media_scans WHERE source_rel = ?
`);
const trackRows = database.query<{ readonly stream_index: number; readonly size_bytes: number }, [string, TrackKind]>(`
  SELECT stream_index, size_bytes FROM media_scan_tracks WHERE source_rel = ? AND kind = ?
`);
const deleteScan = database.query<void, [string]>("DELETE FROM media_scans WHERE source_rel = ?");

export function invalidateMediaScan(rel: string): void {
  deleteScan.run(rel);
}

export async function scannedTrackSizes(rel: string, abs: string, kind: TrackKind): Promise<ReadonlyMap<number, number>> {
  const row = scanByPath.get(rel);
  const stats = row?.status === "complete" ? await lstat(abs).catch(() => null) : null;
  if (row === null || stats === null || row.file_size !== stats.size || row.modified_at !== Math.trunc(stats.mtimeMs)) {
    return new Map();
  }
  return new Map(trackRows.all(rel, kind).map((track) => [track.stream_index, track.size_bytes]));
}
