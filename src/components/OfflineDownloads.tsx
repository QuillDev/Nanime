import { Download, RotateCw, Trash2, X } from "lucide-react";
import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatSize } from "../format.ts";
import { useOfflineDownloads } from "../hooks/useOfflineDownloads.ts";
import { prepareOfflineStorage } from "../offline/capacity.ts";
import type { OfflineDownload } from "../offline/types.ts";

function downloadPercent(item: OfflineDownload): number {
  if (item.state === "preparing") {
    return (item.preparationProgress ?? 0) * 100;
  }
  return item.totalBytes <= 0 ? 0 : item.downloadedBytes / item.totalBytes * 100;
}

function downloadStatus(item: OfflineDownload, percent: number): string {
  if (item.state === "preparing") {
    return `Preparing offline video · ${String(percent)}%`;
  }
  if (item.state === "downloading") {
    return `${String(percent)}% · ${formatSize(item.downloadedBytes)} of ${formatSize(item.totalBytes)}`;
  }
  if (item.state === "complete") {
    return `${formatSize(item.totalBytes)} · Available offline`;
  }
  const state = item.state === "paused" ? "Paused" : "Failed";
  return `${formatSize(item.downloadedBytes)} of ${formatSize(item.totalBytes)} · ${state}`;
}

function DownloadAction({ active, item, onCancel, onRemove, onRetry, retryable }: {
  readonly active: boolean;
  readonly item: OfflineDownload;
  readonly onCancel: () => void;
  readonly onRemove: () => void;
  readonly onRetry: () => void;
  readonly retryable: boolean;
}): React.JSX.Element {
  const className = "flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground";
  if (active) {
    return <button type="button" onClick={onCancel} aria-label={`Cancel ${item.name} download`} className={className}><X className="size-4" /></button>;
  }
  if (retryable) {
    return <button type="button" onClick={onRetry} aria-label={`Retry ${item.name} download`} className={className}><RotateCw className="size-4" /></button>;
  }
  return <button type="button" onClick={onRemove} aria-label={`Remove ${item.name} download`} className={className}><Trash2 className="size-4" /></button>;
}

function DownloadRow({ item, onCancel, onRemove, onRetry }: {
  readonly item: OfflineDownload;
  readonly onCancel: (item: OfflineDownload) => void;
  readonly onRemove: (item: OfflineDownload) => void;
  readonly onRetry: (item: OfflineDownload) => void;
}): React.JSX.Element {
  const active = item.state === "preparing" || item.state === "downloading";
  const retryable = item.state === "failed" || item.state === "paused";
  const handleCancel = useCallback(() => onCancel(item), [item, onCancel]);
  const handleRemove = useCallback(() => onRemove(item), [item, onRemove]);
  const handleRetry = useCallback(() => onRetry(item), [item, onRetry]);
  const percent = downloadPercent(item);
  const roundedPercent = Math.round(percent);
  const status = downloadStatus(item, roundedPercent);
  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-medium" title={item.name}>{item.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {status}
          </p>
        </div>
        <DownloadAction active={active} item={item} onCancel={handleCancel} onRemove={handleRemove} onRetry={handleRetry} retryable={retryable} />
      </div>
      {item.state !== "complete" && (
        <progress
          aria-label={`${item.name} ${item.state} progress`}
          className="playback-progress mt-3 block h-1 w-full"
          max={100}
          value={percent}
        >
          {percent}%
        </progress>
      )}
      {item.error !== null && <p className="mt-2 text-xs text-destructive">{item.error}</p>}
    </li>
  );
}

function useDownloadActions(offline: ReturnType<typeof useOfflineDownloads>) {
  const cancel = useCallback(
    (item: OfflineDownload) => offline.cancel(item.rel),
    [offline],
  );
  const remove = useCallback(
    (item: OfflineDownload) => offline.remove.mutate(item),
    [offline],
  );
  const retry = useCallback(
    (item: OfflineDownload) => offline.start(item),
    [offline],
  );
  return { cancel, remove, retry };
}

export function OfflineDownloads(): React.JSX.Element {
  const offline = useOfflineDownloads();
  const storage = useQuery({
    queryKey: ["offline-storage"],
    queryFn: () => prepareOfflineStorage(0),
    staleTime: 30_000,
  });
  const items = offline.downloads.data ?? [];
  const inProgress = items.filter((item) => item.state === "preparing" || item.state === "downloading");
  const remaining = items.filter((item) => item.state !== "preparing" && item.state !== "downloading");
  const { cancel, remove, retry } = useDownloadActions(offline);
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
        <div className="mt-4 space-y-5">
          {inProgress.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">In progress</h3>
              <ul className="flex flex-col gap-2">
                {inProgress.map((item) => <DownloadRow key={item.id} item={item} onCancel={cancel} onRemove={remove} onRetry={retry} />)}
              </ul>
            </div>
          )}
          {remaining.length > 0 && (
            <div>
              {inProgress.length > 0 && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">On this device</h3>}
              <ul className="flex flex-col gap-2">
                {remaining.map((item) => <DownloadRow key={item.id} item={item} onCancel={cancel} onRemove={remove} onRetry={retry} />)}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
