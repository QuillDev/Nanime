import { RotateCw, Trash2, X } from "lucide-react";
import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatSize } from "../format.ts";
import { useOfflineDownloads } from "../hooks/useOfflineDownloads.ts";
import { useProfileEpisodes } from "../hooks/useProfileEpisodes.ts";
import { episodeShortLabel, profileEpisode, type ProfileEpisodes } from "../lib/profileMedia.ts";
import { prepareOfflineStorage } from "../offline/capacity.ts";
import type { OfflineDownload } from "../offline/types.ts";
import { ProfileEmptyState, ProfileMediaRow, ProfileSection } from "./ProfileSection.tsx";

export const OFFLINE_DOWNLOADS_ID = "offline-downloads";

function isActive(item: OfflineDownload): boolean {
  return item.state === "preparing" || item.state === "downloading";
}

function downloadPercent(item: OfflineDownload): number {
  if (item.state === "preparing") {
    return (item.preparationProgress ?? 0) * 100;
  }
  return item.totalBytes <= 0 ? 0 : item.downloadedBytes / item.totalBytes * 100;
}

function downloadStatus(item: OfflineDownload): string {
  if (item.state === "preparing") {
    return `Preparing · ${String(Math.round(downloadPercent(item)))}%`;
  }
  if (item.state === "complete") {
    return formatSize(item.totalBytes);
  }
  if (item.state === "downloading") {
    return `${formatSize(item.downloadedBytes)} of ${formatSize(item.totalBytes)}`;
  }
  return item.state === "paused" ? "Paused" : item.error ?? "Failed";
}

const actionClass = "flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function DownloadAction({ item, onCancel, onRemove, onRetry }: {
  readonly item: OfflineDownload;
  readonly onCancel: () => void;
  readonly onRemove: () => void;
  readonly onRetry: () => void;
}): React.JSX.Element {
  if (isActive(item)) {
    return <button type="button" onClick={onCancel} aria-label={`Cancel ${item.name} download`} title="Cancel" className={actionClass}><X className="size-4" /></button>;
  }
  if (item.state === "failed" || item.state === "paused") {
    return <button type="button" onClick={onRetry} aria-label={`Retry ${item.name} download`} title="Retry" className={actionClass}><RotateCw className="size-4" /></button>;
  }
  return <button type="button" onClick={onRemove} aria-label={`Remove ${item.name} download`} title="Remove" className={actionClass}><Trash2 className="size-4" /></button>;
}

function DownloadRow({ episodes, item, onCancel, onRemove, onRetry }: {
  readonly episodes: ProfileEpisodes;
  readonly item: OfflineDownload;
  readonly onCancel: (item: OfflineDownload) => void;
  readonly onRemove: (item: OfflineDownload) => void;
  readonly onRetry: (item: OfflineDownload) => void;
}): React.JSX.Element {
  const handleCancel = useCallback(() => onCancel(item), [item, onCancel]);
  const handleRemove = useCallback(() => onRemove(item), [item, onRemove]);
  const handleRetry = useCallback(() => onRetry(item), [item, onRetry]);
  const episode = profileEpisode(episodes, item.rel);
  const label = episodeShortLabel(episode);
  const failed = item.state === "failed";
  return (
    <ProfileMediaRow rel={item.rel} thumbnail={episode.thumbnail}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={item.rel}>{episode.showTitle}</p>
        <p className={`truncate text-[13px] ${failed ? "text-destructive" : "text-muted-foreground"}`}>
          {label === "" ? "" : `${label} · `}{downloadStatus(item)}
        </p>
        {item.state !== "complete" && (
          <progress
            aria-label={`${item.name} ${item.state} progress`}
            className="playback-progress mt-2 block h-0.75 w-full max-w-72"
            max={100}
            value={downloadPercent(item)}
          />
        )}
      </div>
      <DownloadAction item={item} onCancel={handleCancel} onRemove={handleRemove} onRetry={handleRetry} />
    </ProfileMediaRow>
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

function downloadsSummary(items: readonly OfflineDownload[], availableBytes: number | null | undefined): string | undefined {
  const active = items.filter((item) => isActive(item)).length;
  const failed = items.filter((item) => item.state === "failed").length;
  const parts = [
    active > 0 ? `${String(active)} downloading` : null,
    failed > 0 ? `${String(failed)} failed` : null,
  ].filter((part) => part !== null);
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  return availableBytes === null || availableBytes === undefined ? undefined : `${formatSize(availableBytes)} free`;
}

export function OfflineDownloads({ defaultOpen }: { readonly defaultOpen: boolean }): React.JSX.Element {
  const offline = useOfflineDownloads();
  const episodes = useProfileEpisodes();
  const storage = useQuery({
    queryKey: ["offline-storage"],
    queryFn: () => prepareOfflineStorage(0),
    staleTime: 30_000,
  });
  const items = offline.downloads.data ?? [];
  const ordered = [...items.filter((item) => isActive(item)), ...items.filter((item) => !isActive(item))];
  const { cancel, remove, retry } = useDownloadActions(offline);
  return (
    <ProfileSection
      id={OFFLINE_DOWNLOADS_ID}
      title="Downloads"
      summary={downloadsSummary(items, storage.data?.availableBytes)}
      defaultOpen={defaultOpen}
    >
      {ordered.length === 0 ? (
        <ProfileEmptyState>No episodes saved on this device.</ProfileEmptyState>
      ) : (
        <ul>
          {ordered.map((item) => <DownloadRow key={`${String(item.userId)}:${item.rel}`} episodes={episodes} item={item} onCancel={cancel} onRemove={remove} onRetry={retry} />)}
        </ul>
      )}
    </ProfileSection>
  );
}
