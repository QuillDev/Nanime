import { useCallback, useState } from "react";
import { Film, Pause, Play, X } from "lucide-react";
import { useDownloadAction } from "../hooks/useDownloadAction.ts";
import { useDownloads } from "../hooks/useDownloads.ts";
import { downloadDisplay, type DownloadTone } from "../lib/downloadDisplay.ts";
import type { DownloadStatus, ShowMetadata } from "../types.ts";
import { AdminAddMedia } from "./AdminAddMedia.tsx";
import { AdminPage } from "./AdminPage.tsx";
import { RemoveDownloadDialog } from "./RemoveDownloadDialog.tsx";
import { ListSkeleton } from "./Skeleton.tsx";

const TONE_CLASS = {
  active: "text-primary",
  problem: "text-warning",
  waiting: "text-muted-foreground",
} as const satisfies Record<DownloadTone, string>;

const ICON_BUTTON = "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

function Cover({ src }: { readonly src: string | null }): React.JSX.Element {
  return (
    <span className="flex aspect-[2/3] w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary">
      {src === null ? <Film aria-hidden="true" className="size-4 text-muted-foreground" /> : <img src={src} alt="" className="size-full object-cover" />}
    </span>
  );
}

/** Pause while it runs or waits; resume once paused or failed (a retry). */
function PauseResumeButton({ download }: { readonly download: DownloadStatus }): React.JSX.Element {
  const control = useDownloadAction();
  const stopped = download.state === "paused" || download.state === "failed";
  const handleClick = useCallback(() => {
    control.mutate({ id: download.id, action: stopped ? "resume" : "pause" });
  }, [control, download.id, stopped]);
  return (
    <button type="button" onClick={handleClick} disabled={control.isPending} aria-label={`${stopped ? "Resume" : "Pause"} ${download.name}`} title={stopped ? "Resume" : "Pause"} className={ICON_BUTTON}>
      {stopped ? <Play className="size-4" /> : <Pause className="size-4" />}
    </button>
  );
}

function DownloadRow({ download, metadata, onRemove }: {
  readonly download: DownloadStatus;
  readonly metadata: ShowMetadata;
  readonly onRemove: (download: DownloadStatus) => void;
}): React.JSX.Element {
  const display = downloadDisplay(download, metadata);
  const handleRemove = useCallback(() => onRemove(download), [onRemove, download]);
  return (
    <li className="flex items-center gap-4 border-b border-border py-3">
      <Cover src={display.cover} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold">{display.title}</span>
          {display.release !== null && (
            <span title={display.release} className="hidden min-w-0 max-w-72 truncate rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline">{display.release}</span>
          )}
        </p>
        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
          <span className={`font-semibold sm:hidden ${TONE_CLASS[display.tone]}`}>{display.status} · </span>
          {display.size}
        </p>
        <progress aria-label={`${display.title} download progress`} max={1} value={download.progress} className={`${display.tone === "problem" ? "warning-progress" : "playback-progress"} mt-2 block h-0.75 w-full max-w-md`} />
      </div>
      <div className="hidden w-44 shrink-0 text-right text-[13px] sm:block">
        <p className={`text-xs font-semibold ${TONE_CLASS[display.tone]}`}>{display.status}</p>
        <p title={display.detail} className="mt-0.5 truncate text-muted-foreground">{display.detail}</p>
      </div>
      <PauseResumeButton download={download} />
      <button type="button" onClick={handleRemove} aria-label={`Remove ${download.name}`} title="Remove download" className={ICON_BUTTON}>
        <X className="size-4" />
      </button>
    </li>
  );
}

function DownloadList({ metadata, onRemove }: {
  readonly metadata: ShowMetadata;
  readonly onRemove: (download: DownloadStatus) => void;
}): React.JSX.Element {
  const downloads = useDownloads(true);
  if (downloads.status === "pending") {
    return <ListSkeleton />;
  }
  if (downloads.status === "error") {
    return <p className="select-text py-4 text-sm text-destructive">{downloads.error.message}</p>;
  }
  const { torrentError } = downloads.data;
  return (
    <>
      {torrentError !== null && <p className="select-text py-2 text-sm text-warning">{torrentError}; torrents aren’t shown.</p>}
      {downloads.data.downloads.length === 0
        ? <p className="py-10 text-sm text-muted-foreground">Nothing downloading.</p>
        : (
          <ul>
            {downloads.data.downloads.map((download) => <DownloadRow key={download.id} download={download} metadata={metadata} onRemove={onRemove} />)}
          </ul>
        )}
    </>
  );
}

export function AdminDownloads({ showFolders, metadata }: {
  readonly showFolders: readonly string[];
  readonly metadata: ShowMetadata;
}): React.JSX.Element {
  const [removeTarget, setRemoveTarget] = useState<DownloadStatus | null>(null);
  const handleRemoveClose = useCallback(() => setRemoveTarget(null), []);
  return (
    <AdminPage title="Downloads">
      <AdminAddMedia showFolders={showFolders} />
      <div className="mt-6">
        <DownloadList metadata={metadata} onRemove={setRemoveTarget} />
      </div>
      {removeTarget !== null && <RemoveDownloadDialog download={removeTarget} onClose={handleRemoveClose} />}
    </AdminPage>
  );
}
