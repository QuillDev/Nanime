import { useCallback, useState } from "react";
import { Film, X } from "lucide-react";
import { useTorrents } from "../hooks/useTorrents.ts";
import { torrentDisplay, type TorrentTone } from "../lib/torrentDisplay.ts";
import type { ShowMetadata, TorrentStatus } from "../types.ts";
import { AdminAddMedia } from "./AdminAddMedia.tsx";
import { AdminPage } from "./AdminPage.tsx";
import { CancelTorrentDialog } from "./CancelTorrentDialog.tsx";
import { ListSkeleton } from "./Skeleton.tsx";

const TONE_CLASS = {
  active: "text-primary",
  done: "text-muted-foreground",
  problem: "text-warning",
  waiting: "text-muted-foreground",
} as const satisfies Record<TorrentTone, string>;

function Cover({ src }: { readonly src: string | null }): React.JSX.Element {
  return (
    <span className="flex aspect-[2/3] w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary">
      {src === null ? <Film aria-hidden="true" className="size-4 text-muted-foreground" /> : <img src={src} alt="" className="size-full object-cover" />}
    </span>
  );
}

function TorrentRow({ torrent, metadata, onCancel }: {
  readonly torrent: TorrentStatus;
  readonly metadata: ShowMetadata;
  readonly onCancel: (torrent: TorrentStatus) => void;
}): React.JSX.Element {
  const display = torrentDisplay(torrent, metadata);
  const handleCancel = useCallback(() => onCancel(torrent), [onCancel, torrent]);
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
        {torrent.progress < 1 && (
          <progress aria-label={`${display.title} download progress`} max={1} value={torrent.progress} className={`${display.tone === "problem" ? "warning-progress" : "playback-progress"} mt-2 block h-0.75 w-full max-w-md`} />
        )}
      </div>
      <div className="hidden w-36 shrink-0 text-right text-[13px] sm:block">
        <p className={`text-xs font-semibold ${TONE_CLASS[display.tone]}`}>{display.status}</p>
        <p className="mt-0.5 truncate text-muted-foreground">{display.detail}</p>
      </div>
      <button type="button" onClick={handleCancel} aria-label={`Remove ${torrent.name}`} title="Remove download" className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X className="size-4" />
      </button>
    </li>
  );
}

function TorrentList({ metadata, onCancel }: {
  readonly metadata: ShowMetadata;
  readonly onCancel: (torrent: TorrentStatus) => void;
}): React.JSX.Element {
  const torrents = useTorrents(true);
  if (torrents.status === "pending") {
    return <ListSkeleton />;
  }
  if (torrents.status === "error") {
    return <p className="select-text py-4 text-sm text-destructive">{torrents.error.message}</p>;
  }
  if (torrents.data.length === 0) {
    return <p className="py-10 text-sm text-muted-foreground">Nothing downloading.</p>;
  }
  const ordered = torrents.data.toSorted((a, b) => Number(a.progress >= 1) - Number(b.progress >= 1) || b.addedOn - a.addedOn);
  return (
    <ul>
      {ordered.map((torrent) => <TorrentRow key={torrent.hash} torrent={torrent} metadata={metadata} onCancel={onCancel} />)}
    </ul>
  );
}

export function AdminDownloads({ showFolders, metadata }: {
  readonly showFolders: readonly string[];
  readonly metadata: ShowMetadata;
}): React.JSX.Element {
  const [cancelTarget, setCancelTarget] = useState<TorrentStatus | null>(null);
  const handleCancelClose = useCallback(() => setCancelTarget(null), []);
  return (
    <AdminPage title="Downloads">
      <AdminAddMedia showFolders={showFolders} />
      <div className="mt-6">
        <TorrentList metadata={metadata} onCancel={setCancelTarget} />
      </div>
      {cancelTarget !== null && <CancelTorrentDialog torrent={cancelTarget} onClose={handleCancelClose} />}
    </AdminPage>
  );
}
