import { database, db, type DownloadJobRow, DownloadJobRowSchema, execute, queryOne, queryRows, sql, TableColumnRowSchema } from "./database.ts";

/**
 * Direct (non-torrent) downloads. Rows outlive the process so a restart picks
 * up where it left off; a finished download's row is removed once its file is
 * in the library.
 */
database.run(`
  CREATE TABLE IF NOT EXISTS download_jobs (
    id TEXT PRIMARY KEY,
    show_folder TEXT NOT NULL,
    file_name TEXT NOT NULL,
    url TEXT NOT NULL,
    headers TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('file', 'hls')),
    state TEXT NOT NULL CHECK (state IN ('queued', 'downloading', 'paused', 'failed')),
    received INTEGER NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    added_at INTEGER NOT NULL
  )
`);
// Episodes queued from a source plugin: the plugin resolves the episode to a
// video (or magnet) when the download starts, because those links expire.
const columns = new Set(queryRows(sql`PRAGMA table_info(download_jobs)`, TableColumnRowSchema).map((column) => column.name));
if (!columns.has("source_id")) {
  database.run("ALTER TABLE download_jobs ADD COLUMN source_id TEXT");
  database.run("ALTER TABLE download_jobs ADD COLUMN episode_url TEXT");
}
// A process that stopped mid-download left its jobs "downloading"; they resume.
execute(db.updateTable("download_jobs").set({ state: "queued" }).where("state", "=", "downloading"));

type JobRow = DownloadJobRow;
export type FileDownloadFormat = JobRow["format"];
export type FileDownloadState = JobRow["state"];

export interface FileDownloadJob {
  readonly id: string;
  readonly showFolder: string;
  readonly fileName: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly format: FileDownloadFormat;
  readonly state: FileDownloadState;
  readonly received: number;
  readonly size: number;
  readonly error: string | null;
  readonly addedAt: number;
  /** Set for an episode from a source plugin; `url` is resolved from it when the download starts. */
  readonly episode: SourceEpisode | null;
}

export interface SourceEpisode {
  readonly sourceId: string;
  readonly url: string;
}

/** A source episode once its plugin says what it is right now. */
export interface SubtitleLink {
  readonly url: string;
  readonly label: string;
}

export type ResolvedEpisode =
  | { readonly kind: "torrent"; readonly magnet: string }
  | {
    readonly kind: "file";
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly format: "file" | "hls";
    /** The file's extension when it's a plain video file, else `.mp4` (HLS is saved as MP4). */
    readonly extension: string;
    readonly subtitles: readonly SubtitleLink[];
  };


function job(row: JobRow): FileDownloadJob {
  return {
    id: row.id,
    showFolder: row.show_folder,
    fileName: row.file_name,
    url: row.url,
    headers: JSON.parse(row.headers) as Readonly<Record<string, string>>,
    format: row.format,
    state: row.state,
    received: row.received,
    size: row.size,
    error: row.error,
    addedAt: row.added_at,
    episode: row.source_id === null || row.episode_url === null ? null : { sourceId: row.source_id, url: row.episode_url },
  };
}

export function fileDownloadJobs(): readonly FileDownloadJob[] {
  return queryRows(sql`SELECT * FROM download_jobs ORDER BY added_at, rowid`, DownloadJobRowSchema).map((row) => job(row));
}

export function fileDownloadJob(id: string): FileDownloadJob | null {
  const row = queryOne(db.selectFrom("download_jobs").selectAll().where("id", "=", id), DownloadJobRowSchema);
  return row === null ? null : job(row);
}

export interface NewFileDownload {
  readonly id: string;
  readonly showFolder: string;
  readonly fileName: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly format: FileDownloadFormat;
  readonly episode: SourceEpisode | null;
}

/** Adds every item or none. */
export function insertFileDownloads(items: readonly NewFileDownload[]): void {
  const now = Date.now();
  database.transaction(() => {
    for (const item of items) {
      execute(db.insertInto("download_jobs").values({
        id: item.id, show_folder: item.showFolder, file_name: item.fileName, url: item.url, headers: JSON.stringify(item.headers),
        format: item.format, state: "queued", added_at: now, source_id: item.episode?.sourceId ?? null, episode_url: item.episode?.url ?? null,
      }));
    }
  })();
}

export function setFileDownloadState(id: string, state: FileDownloadState, error: string | null = null): void {
  execute(db.updateTable("download_jobs").set({ state, error }).where("id", "=", id));
}

export function setFileDownloadProgress(id: string, received: number, size: number): void {
  execute(db.updateTable("download_jobs").set({ received, size }).where("id", "=", id));
}

export function deleteFileDownload(id: string): void {
  execute(db.deleteFrom("download_jobs").where("id", "=", id));
}
