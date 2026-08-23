import { Download } from "lucide-react";
import { formatDuration, formatSize } from "../api.ts";
import { useTorrents } from "../hooks/useTorrents.ts";
import type { TorrentStatus } from "../types.ts";
import { AdminPanel } from "./AdminPanel.tsx";

const STATE_LABELS: Readonly<Record<string, string>> = {
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
};

function statusLabel(torrent: TorrentStatus): string {
  return torrent.progress >= 1 ? "Complete" : STATE_LABELS[torrent.state] ?? torrent.state;
}

function etaLabel(eta: number): string {
  return eta <= 0 || eta >= 8_640_000 ? "ETA unknown" : `${formatDuration(eta)} remaining`;
}

function TorrentRow({ torrent }: { readonly torrent: TorrentStatus }): React.JSX.Element {
  const percentage = Math.max(0, Math.min(100, torrent.progress * 100));
  return (
    <li className="space-y-2 border-b border-border py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <p className="min-w-0 break-words text-sm font-medium">{torrent.name}</p>
        <span className="shrink-0 text-xs text-muted-foreground">{statusLabel(torrent)}</span>
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
  return (
    <AdminPanel
      title="Downloads"
      description="Active and recently completed torrents. Refreshes every two seconds."
      icon={Download}
      className="xl:col-span-2"
    >
      {torrents.status === "pending" && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading downloads…</p>
      )}
      {torrents.status === "error" && (
        <p className="py-4 text-sm text-destructive">{torrents.error.message}</p>
      )}
      {torrents.status === "success" && torrents.data.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">No torrents found.</p>
      )}
      {torrents.status === "success" && torrents.data.length > 0 && (
        <ul>{torrents.data.map((torrent) => <TorrentRow key={torrent.hash} torrent={torrent} />)}</ul>
      )}
    </AdminPanel>
  );
}
