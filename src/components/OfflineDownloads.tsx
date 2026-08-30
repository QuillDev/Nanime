import { Download, Trash2 } from "lucide-react";
import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatSize } from "../format.ts";
import { useOfflineDownloads } from "../hooks/useOfflineDownloads.ts";
import { prepareOfflineStorage } from "../offline/capacity.ts";
import type { OfflineDownload } from "../offline/types.ts";

function DownloadRow({ item, onRemove }: {
  readonly item: OfflineDownload;
  readonly onRemove: (item: OfflineDownload) => void;
}): React.JSX.Element {
  const handleRemove = useCallback(() => onRemove(item), [item, onRemove]);
  const percent = item.totalBytes <= 0 ? 0 : item.downloadedBytes / item.totalBytes * 100;
  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-medium" title={item.name}>{item.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.state === "complete"
              ? `${formatSize(item.totalBytes)} · Available offline`
              : `${formatSize(item.downloadedBytes)} of ${formatSize(item.totalBytes)} · ${item.state}`}
          </p>
        </div>
        <button
          type="button"
          onClick={handleRemove}
          aria-label={`Remove ${item.name} download`}
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      {item.state !== "complete" && (
        <progress className="playback-progress mt-3 block h-1 w-full" max={100} value={percent}>
          {percent}%
        </progress>
      )}
      {item.error !== null && <p className="mt-2 text-xs text-destructive">{item.error}</p>}
    </li>
  );
}

export function OfflineDownloads(): React.JSX.Element {
  const offline = useOfflineDownloads();
  const storage = useQuery({
    queryKey: ["offline-storage"],
    queryFn: () => prepareOfflineStorage(0),
    staleTime: 30_000,
  });
  const items = offline.downloads.data ?? [];
  const remove = useCallback((item: OfflineDownload) => offline.remove.mutate(item), [offline.remove]);
  return (
    <section className="border-b border-border py-6" aria-labelledby="offline-downloads-title">
      <div className="flex items-center gap-2">
        <Download className="size-5 text-primary" />
        <h2 id="offline-downloads-title" className="text-lg font-semibold">Offline downloads</h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Download an episode from its three-dot menu, then play and seek without reaching the server.
      </p>
      {storage.data !== undefined && (
        <p className="mt-2 text-xs text-muted-foreground">
          {storage.data.availableBytes === null
            ? "Browser storage availability is not reported on this device."
            : `${formatSize(storage.data.availableBytes)} currently available in browser storage.`}
          {storage.data.persisted ? " Storage protection is enabled." : " Downloads may be removed under device storage pressure."}
        </p>
      )}
      {items.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No episodes are stored on this device.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {items.map((item) => <DownloadRow key={item.id} item={item} onRemove={remove} />)}
        </ul>
      )}
    </section>
  );
}
