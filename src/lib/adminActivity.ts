import type { DownloadStatus, TranscodeJob } from "../types.ts";

export interface ActivitySummary {
  /** Short live value for the sidebar (count or percent); empty when idle. */
  readonly label: string;
  /** 0-1 progress of the running work, or null when nothing is running. */
  readonly progress: number | null;
}

const IDLE: ActivitySummary = { label: "", progress: null };

/** Number of unfinished downloads and their combined byte progress. */
export function downloadsSummary(downloads: readonly DownloadStatus[]): ActivitySummary {
  if (downloads.length === 0) {
    return IDLE;
  }
  const size = downloads.reduce((total, download) => total + download.size, 0);
  const done = downloads.reduce((total, download) => total + download.completed, 0);
  return { label: String(downloads.length), progress: size > 0 ? done / size : 0 };
}

/** Percent of the running transcode, else the queued count. */
export function transcodesSummary(jobs: readonly TranscodeJob[]): ActivitySummary {
  const running = jobs.find((job) => job.status === "processing");
  if (running !== undefined) {
    return { label: `${String(Math.round(running.progress * 100))}%`, progress: running.progress };
  }
  const queued = jobs.filter((job) => job.status === "queued").length;
  return queued === 0 ? IDLE : { label: `${String(queued)} queued`, progress: null };
}
