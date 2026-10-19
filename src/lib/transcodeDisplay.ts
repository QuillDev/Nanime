import { formatDuration, formatSize } from "../format.ts";
import type { TranscodeJob } from "../types.ts";

export const PRESET_NAMES = {
  "space-saver": "Space Saver",
  compatibility: "Compatibility",
} as const;

export function isActiveJob(job: TranscodeJob): boolean {
  return job.status === "queued" || job.status === "processing";
}

function remaining(job: TranscodeJob): string {
  if (job.startedAt === null || job.progress <= 0) {
    return "";
  }
  const elapsed = (job.updatedAt - job.startedAt) / 1000;
  return `${formatDuration(elapsed / job.progress * (1 - job.progress))} left`;
}

/** Status headline and its secondary line for one transcode job. */
export interface JobStatus {
  readonly status: string;
  readonly detail: string;
}

export function jobStatus(job: TranscodeJob): JobStatus {
  switch (job.status) {
    case "processing": {
      const speed = job.speed > 0 ? `${job.speed.toFixed(2)}x` : "";
      return {
        status: `Encoding · ${String(Math.round(job.progress * 100))}%`,
        detail: [speed, remaining(job)].filter((part) => part !== "").join(" · "),
      };
    }
    case "queued": {
      return { status: "Queued", detail: "" };
    }
    case "complete": {
      return { status: "Done", detail: job.originalDeleted ? "Original deleted" : "Original kept" };
    }
    case "failed": {
      return { status: "Failed", detail: job.error ?? "" };
    }
    case "cancelled": {
      return { status: "Cancelled", detail: "" };
    }
  }
}

export function jobSizes(job: TranscodeJob): string {
  if (job.outputSize === null) {
    return `${formatSize(job.inputSize)} · ${PRESET_NAMES[job.preset]}`;
  }
  const saved = job.inputSize - job.outputSize;
  const savings = saved > 0 ? ` · saved ${formatSize(saved)}` : "";
  return `${formatSize(job.inputSize)} → ${formatSize(job.outputSize)}${savings}`;
}
