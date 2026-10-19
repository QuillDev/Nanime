import { useMemo } from "react";
import { useProfileEpisodes } from "../hooks/useProfileEpisodes.ts";
import { useTranscodes } from "../hooks/useTranscodes.ts";
import { episodeShortLabel, profileEpisode, type ProfileEpisodes } from "../lib/profileMedia.ts";
import { isActiveJob, jobSizes, jobStatus } from "../lib/transcodeDisplay.ts";
import type { TranscodeJob } from "../types.ts";
import { AdminPage } from "./AdminPage.tsx";
import { MediaThumbnail } from "./MediaThumbnail.tsx";
import { ListSkeleton } from "./Skeleton.tsx";
import { TranscodeJobActions } from "./TranscodeJobActions.tsx";

const STATUS_CLASS = {
  processing: "text-primary",
  queued: "text-muted-foreground",
  complete: "text-muted-foreground",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
} as const satisfies Record<TranscodeJob["status"], string>;

function JobRow({ job, episodes }: {
  readonly job: TranscodeJob;
  readonly episodes: ProfileEpisodes;
}): React.JSX.Element {
  const episode = profileEpisode(episodes, job.sourcePath);
  const { status, detail } = jobStatus(job);
  return (
    <li className="flex items-center gap-4 border-b border-border py-3">
      <span className="w-20 shrink-0 overflow-hidden rounded-md sm:w-24">
        <MediaThumbnail rel={job.sourcePath} source={episode.thumbnail} className="w-full" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate" title={job.sourcePath}>
          <span className="font-semibold">{episode.showTitle}</span>
          <span className="text-muted-foreground"> {episodeShortLabel(episode)}</span>
        </p>
        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
          <span className={`font-semibold sm:hidden ${STATUS_CLASS[job.status]}`}>{status} · </span>
          {jobSizes(job)}
        </p>
        {job.status === "processing" && (
          <progress aria-label={`${episode.showTitle} transcode progress`} max={1} value={job.progress} className="playback-progress mt-2 block h-0.75 w-full max-w-md" />
        )}
      </div>
      <div className="hidden w-44 shrink-0 text-right text-[13px] sm:block">
        <p className={`text-xs font-semibold ${STATUS_CLASS[job.status]}`}>{status}</p>
        <p className="mt-0.5 truncate text-muted-foreground" title={detail}>{detail}</p>
      </div>
      <TranscodeJobActions job={job} />
    </li>
  );
}

function JobList({ jobs, episodes }: { readonly jobs: readonly TranscodeJob[]; readonly episodes: ProfileEpisodes }): React.JSX.Element {
  return <ul>{jobs.map((job) => <JobRow key={job.id} job={job} episodes={episodes} />)}</ul>;
}

/** Running first, then queued, then failed or cancelled; finished jobs listed separately. */
function splitJobs(jobs: readonly TranscodeJob[]) {
  const active = jobs.filter((job) => isActiveJob(job)).toSorted((a, b) => Number(b.status === "processing") - Number(a.status === "processing"));
  const attention = jobs.filter((job) => job.status === "failed" || job.status === "cancelled");
  return { current: [...active, ...attention], finished: jobs.filter((job) => job.status === "complete") };
}

function TranscodeLists({ jobs }: { readonly jobs: readonly TranscodeJob[] }): React.JSX.Element {
  const episodes = useProfileEpisodes();
  const { current, finished } = useMemo(() => splitJobs(jobs), [jobs]);
  return (
    <>
      {current.length === 0
        ? <p className="py-6 text-sm text-muted-foreground">Nothing transcoding.</p>
        : <JobList jobs={current} episodes={episodes} />}
      {finished.length > 0 && (
        <section aria-labelledby="transcodes-finished" className="mt-10">
          <h2 id="transcodes-finished" className="font-display text-lg font-bold tracking-tight">Finished</h2>
          <JobList jobs={finished} episodes={episodes} />
        </section>
      )}
    </>
  );
}

export function AdminTranscodes(): React.JSX.Element {
  const transcodes = useTranscodes();
  return (
    <AdminPage title="Transcodes">
      {transcodes.status === "pending" && <ListSkeleton />}
      {transcodes.status === "error" && <p className="select-text py-4 text-sm text-destructive">{transcodes.error.message}</p>}
      {transcodes.status === "success" && <TranscodeLists jobs={transcodes.data} />}
    </AdminPage>
  );
}
