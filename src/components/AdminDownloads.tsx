import { useCallback, useState } from "react";
import { CircleX, Download } from "lucide-react";
import { formatDuration, formatSize } from "../format.ts";
import { useTorrents } from "../hooks/useTorrents.ts";
import type { TorrentStatus } from "../types.ts";
import { AdminPanel } from "./AdminPanel.tsx";
import { CancelTorrentDialog } from "./CancelTorrentDialog.tsx";
import { ListSkeleton } from "./Skeleton.tsx";

const STATE_LABELS = new Map(Object.entries({
  allocating: "Allocating",
  checkingDL: "Checking",
  checkingResumeData: "Checking",
  checkingUP: "Checking",
  downloading: "Downloading",
  error: "Error",
  forcedDL: "Downloading",
  forcedUP: "Seeding",
  metaDL: "Fetching metadata",
  missingFiles: "Missing files",
  moving: "Moving",
  pausedDL: "Paused",
  pausedUP: "Complete",
  queuedDL: "Queued",
  queuedUP: "Complete",
  stalledDL: "Stalled",
  stalledUP: "Complete",
  uploading: "Seeding",
} as const));

function statusLabel(torrent: TorrentStatus): string {
  return torrent.progress >= 1 ? "Complete" : STATE_LABELS.get(torrent.state) ?? torrent.state;
}

function etaLabel(eta: number): string {
  return eta <= 0 || eta >= 8_640_000 ? "ETA unknown" : `${formatDuration(eta)} remaining`;
}

function TorrentRow({
  torrent,
  onCancel,
}: {
  readonly torrent: TorrentStatus;
  readonly onCancel: (torrent: TorrentStatus) => void;
}): React.JSX.Element {
  const percentage = Math.max(0, Math.min(100, torrent.progress * 100));
  const handleCancel = useCallback(() => onCancel(torrent), [onCancel, torrent]);
  return (
    <li className="space-y-2 border-b border-border py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <p className="min-w-0 break-words text-sm font-medium">{torrent.name}</p>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">{statusLabel(torrent)}</span>
          <button
            type="button"
            onClick={handleCancel}
            aria-label={`Cancel ${torrent.name}`}
            title="Cancel torrent"
            className="rounded p-1 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CircleX aria-hidden="true" className="size-4" />
          </button>
        </span>
      </div>
      <progress
        aria-label={`${torrent.name} download progress`}
        value={percentage}
        max={100}
        className="playback-progress h-2 w-full overflow-hidden rounded-full"
      />
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{percentage.toFixed(1)}% · {formatSize(torrent.completed)} / {formatSize(torrent.size)}</span>
        {torrent.progress < 1 && (
          <span>
            {torrent.downloadSpeed > 0 ? `${formatSize(torrent.downloadSpeed)}/s · ` : ""}
            {etaLabel(torrent.eta)}
          </span>
        )}
      </div>
    </li>
  );
}

export function AdminDownloads(): React.JSX.Element {
  const torrents = useTorrents(true);
  const [cancelTarget, setCancelTarget] = useState<TorrentStatus | null>(null);
  const handleCancel = useCallback((torrent: TorrentStatus) => setCancelTarget(torrent), []);
  const handleCancelClose = useCallback(() => setCancelTarget(null), []);
  return (
    <>
      <AdminPanel
        title="Active downloads"
        description="Live qBittorrent activity, refreshed every two seconds."
        icon={Download}
        className="xl:col-span-3"
      >
        {torrents.status === "pending" && (
          <ListSkeleton />
        )}
        {torrents.status === "error" && (
          <p className="py-4 text-sm text-destructive">{torrents.error.message}</p>
        )}
        {torrents.status === "success" && torrents.data.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-sm font-medium">All caught up</p>
            <p className="mt-1 text-xs text-muted-foreground">No downloads are currently active.</p>
          </div>
        )}
        {torrents.status === "success" && torrents.data.length > 0 && (
          <ul>
            {torrents.data.map((torrent) => (
              <TorrentRow key={torrent.hash} torrent={torrent} onCancel={handleCancel} />
            ))}
          </ul>
        )}
      </AdminPanel>
      {cancelTarget !== null && (
        <CancelTorrentDialog torrent={cancelTarget} onClose={handleCancelClose} />
      )}
    </>
  );
}
