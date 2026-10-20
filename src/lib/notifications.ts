import type { DownloadStatus, TranscodeJob } from "../types.ts";
import type { ShowGroup } from "./library.ts";
import { downloadDisplay } from "./downloadDisplay.ts";
import { isActiveJob } from "./transcodeDisplay.ts";

/** Bell dot: amber when something needs an admin, pink while work runs, none when idle. */
export type BellTone = "idle" | "busy" | "attention";

export interface Notifications {
  readonly unmapped: readonly ShowGroup[];
  readonly downloads: readonly DownloadStatus[];
  readonly transcodes: readonly TranscodeJob[];
  readonly tone: BellTone;
}

export interface NotificationSources {
  readonly unmapped: readonly ShowGroup[];
  readonly downloads: readonly DownloadStatus[];
  readonly jobs: readonly TranscodeJob[];
}

export function isStuckDownload(download: DownloadStatus): boolean {
  return downloadDisplay(download, {}).tone === "problem";
}

function bellTone(notifications: Omit<Notifications, "tone">): BellTone {
  if (notifications.unmapped.length > 0 || notifications.downloads.some((download) => isStuckDownload(download))) {
    return "attention";
  }
  return notifications.downloads.length > 0 || notifications.transcodes.length > 0 ? "busy" : "idle";
}

/** Things an admin should act on or keep an eye on: unmatched shows, unfinished downloads, running transcodes. */
export function collectNotifications(sources: NotificationSources): Notifications {
  const { unmapped, jobs } = sources;
  const downloads = sources.downloads
    .toSorted((a, b) => Number(isStuckDownload(b)) - Number(isStuckDownload(a)) || b.addedOn - a.addedOn);
  const transcodes = jobs
    .filter((job) => isActiveJob(job))
    .toSorted((a, b) => Number(b.status === "processing") - Number(a.status === "processing") || a.createdAt - b.createdAt);
  const collected = { unmapped, downloads, transcodes };
  return { ...collected, tone: bellTone(collected) };
}
