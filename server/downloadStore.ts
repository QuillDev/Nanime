import { database } from "./database.ts";

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
const columns = new Set(database.query<{ readonly name: string }, []>("PRAGMA table_info(download_jobs)").all().map((column) => column.name));
if (!columns.has("source_id")) {
  database.run("ALTER TABLE download_jobs ADD COLUMN source_id TEXT");
  database.run("ALTER TABLE download_jobs ADD COLUMN episode_url TEXT");
}
// A process that stopped mid-download left its jobs "downloading"; they resume.
database.run("UPDATE download_jobs SET state = 'queued' WHERE state = 'downloading'");

export type FileDownloadFormat = "file" | "hls";
export type FileDownloadState = "queued" | "downloading" | "paused" | "failed";

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


interface JobRow {
  readonly id: string;
  readonly show_folder: string;
  readonly file_name: string;
  readonly url: string;
  readonly headers: string;
  readonly format: FileDownloadFormat;
  readonly state: FileDownloadState;
  readonly received: number;
  readonly size: number;
  readonly error: string | null;
  readonly added_at: number;
  readonly source_id: string | null;
  readonly episode_url: string | null;
}

const selectAll = database.query<JobRow, []>("SELECT * FROM download_jobs ORDER BY added_at, rowid");
const selectOne = database.query<JobRow, [string]>("SELECT * FROM download_jobs WHERE id = ?");
const insert = database.query<unknown, [string, string, string, string, string, FileDownloadFormat, number, string | null, string | null]>(`
  INSERT INTO download_jobs (id, show_folder, file_name, url, headers, format, state, added_at, source_id, episode_url)
  VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
`);
const updateState = database.query<unknown, [FileDownloadState, string | null, string]>(
  "UPDATE download_jobs SET state = ?, error = ? WHERE id = ?",
);
const updateProgress = database.query<unknown, [number, number, string]>(
  "UPDATE download_jobs SET received = ?, size = ? WHERE id = ?",
);
const remove = database.query<unknown, [string]>("DELETE FROM download_jobs WHERE id = ?");

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
  return selectAll.all().map((row) => job(row));
}

export function fileDownloadJob(id: string): FileDownloadJob | null {
  const row = selectOne.get(id);
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
      insert.run(item.id, item.showFolder, item.fileName, item.url, JSON.stringify(item.headers), item.format, now, item.episode?.sourceId ?? null, item.episode?.url ?? null);
    }
  })();
}

export function setFileDownloadState(id: string, state: FileDownloadState, error: string | null = null): void {
  updateState.run(state, error, id);
}

export function setFileDownloadProgress(id: string, received: number, size: number): void {
  updateProgress.run(received, size, id);
}

export function deleteFileDownload(id: string): void {
  remove.run(id);
}
