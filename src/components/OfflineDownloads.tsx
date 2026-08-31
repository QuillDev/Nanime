import { Download, RotateCw, Trash2, X } from "lucide-react";
import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatSize } from "../format.ts";
import { useOfflineDownloads } from "../hooks/useOfflineDownloads.ts";
import { prepareOfflineStorage } from "../offline/capacity.ts";
import type { OfflineDownload } from "../offline/types.ts";
import { ProfileEmptyState, ProfileSection } from "./ProfileSection.tsx";

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
    <li className="px-4 py-4 sm:px-5">
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

function storageDescription(storage: Awaited<ReturnType<typeof prepareOfflineStorage>> | undefined): string {
  if (storage === undefined) {
    return "Episodes saved in this browser.";
  }
  const capacity = storage.availableBytes === null
    ? "Storage availability unknown"
    : `${formatSize(storage.availableBytes)} available`;
  return `${capacity} · ${storage.persisted ? "Protected storage" : "Browser-managed storage"}`;
}

export function OfflineDownloads({ className }: { readonly className?: string }): React.JSX.Element {
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
    <ProfileSection
      className={className}
      description={storageDescription(storage.data)}
      icon={Download}
      id="offline-downloads-title"
      title="Downloads"
    >
      <span id="offline-downloads" className="block scroll-mt-20" />
      {items.length === 0 ? (
        <ProfileEmptyState>No episodes saved on this device.</ProfileEmptyState>
      ) : (
        <div className="divide-y divide-border">
          {inProgress.length > 0 && (
            <div className="pb-1">
              <h3 className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:px-5">In progress</h3>
              <ul className="divide-y divide-border">
                {inProgress.map((item) => <DownloadRow key={`${String(item.userId)}:${item.rel}`} item={item} onCancel={cancel} onRemove={remove} onRetry={retry} />)}
              </ul>
            </div>
          )}
          {remaining.length > 0 && (
            <div className="pb-1">
              {inProgress.length > 0 && <h3 className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:px-5">On this device</h3>}
              <ul className="divide-y divide-border">
                {remaining.map((item) => <DownloadRow key={`${String(item.userId)}:${item.rel}`} item={item} onCancel={cancel} onRemove={remove} onRetry={retry} />)}
              </ul>
            </div>
          )}
        </div>
      )}
    </ProfileSection>
  );
}
