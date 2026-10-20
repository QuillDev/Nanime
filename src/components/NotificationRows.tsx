import { useCallback } from "react";
import { Film } from "lucide-react";
import { navigateToAdminTab } from "../hooks/useMediaRoute.ts";
import { torrentDisplay } from "../lib/torrentDisplay.ts";
import { jobStatus } from "../lib/transcodeDisplay.ts";
import { episodeShortLabel, profileEpisode, type ProfileEpisodes } from "../lib/profileMedia.ts";
import type { ShowMetadata, TorrentStatus, TranscodeJob } from "../types.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";

const ROW = "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface RowProps {
  readonly onNavigate: () => void;
}

export function DownloadRow({ torrent, metadata, onNavigate }: RowProps & {
  readonly torrent: TorrentStatus;
  readonly metadata: ShowMetadata;
}): React.JSX.Element {
  const display = torrentDisplay(torrent, metadata);
  const problem = display.tone === "problem";
  const handleOpen = useCallback(() => {
    onNavigate();
    navigateToAdminTab("downloads");
  }, [onNavigate]);
  return (
    <li>
      <button type="button" onClick={handleOpen} className={ROW}>
        <span className="flex aspect-[2/3] w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-secondary">
          {display.cover === null ? <Film aria-hidden="true" className="size-3.5 text-muted-foreground" /> : <img src={display.cover} alt="" className="size-full object-cover" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{display.title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            <span className={problem ? "font-semibold text-warning" : undefined}>{display.status}</span>
            {` · ${String(Math.round(torrent.progress * 100))}%`}
          </span>
          <progress aria-label={`${display.title} download progress`} max={1} value={torrent.progress} className={`${problem ? "warning-progress" : "playback-progress"} mt-1.5 block h-0.75 w-full`} />
        </span>
      </button>
    </li>
  );
}

export function TranscodeRow({ job, episodes, onNavigate }: RowProps & {
  readonly job: TranscodeJob;
  readonly episodes: ProfileEpisodes;
}): React.JSX.Element {
  const episode = profileEpisode(episodes, job.sourcePath);
  const handleOpen = useCallback(() => {
    onNavigate();
    navigateToAdminTab("transcodes");
  }, [onNavigate]);
  return (
    <li>
      <button type="button" onClick={handleOpen} title={job.sourcePath} className={ROW}>
        <span className="w-14 shrink-0 overflow-hidden rounded">
          <MediaThumbnail rel={job.sourcePath} source={episode.thumbnail} className="w-full" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            <span className="font-medium">{episode.showTitle}</span>
            <span className="text-muted-foreground"> {episodeShortLabel(episode)}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{jobStatus(job).status}</span>
          {job.status === "processing" && (
            <progress aria-label={`${episode.showTitle} transcode progress`} max={1} value={job.progress} className="playback-progress mt-1.5 block h-0.75 w-full" />
          )}
        </span>
      </button>
    </li>
  );
}
