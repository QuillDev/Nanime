import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback } from "react";
import type { MediaEntry, OfflineMediaArtifact, SubtitleTrack } from "../types.ts";
import { downloadOfflineMedia } from "../offline/download.ts";
import { prepareOfflineStorage } from "../offline/capacity.ts";
import type { OfflineDownload, OfflineDownloadStore } from "../offline/types.ts";
import {
  activeOfflineProfile,
  announceOfflineDownload,
  cancelTrackedOfflineDownload,
  mergeOfflineDownloads,
  preparingOfflineDownload,
  stopTrackingOfflineDownload,
  stopTrackingOfflineController,
  trackedOfflineDownloads,
  trackOfflineDownload,
  trackOfflineController,
  updateOfflineDownloadList,
  offlineStore,
} from "../offline/runtime.ts";
import {
  subtitleUrl,
  thumbnailUrl,
} from "../api.ts";
import { fetchOfflineMediaArtifact, prepareOfflineMedia } from "../offlineApi.ts";
import { preloadPlayer } from "../routeModules.ts";

const offlineDownloadsKey = ["offline-downloads"] as const;
const OFFLINE_ASSET_CACHE = "nanime-offline-assets-v1";

async function cacheResponse(cache: Cache, url: string): Promise<Response | null> {
  const request = new Request(url);
  const response = await fetch(request);
  if (!response.ok) {
    return null;
  }
  await cache.put(request, response.clone());
  return response;
}

async function cacheOfflineAssets(entry: MediaEntry): Promise<void> {
  if (typeof caches === "undefined") {
    return;
  }
  const cache = await caches.open(OFFLINE_ASSET_CACHE);
  const tracksUrl = `/api/subtitles?path=${encodeURIComponent(entry.rel)}`;
  const tracksResponse = await cacheResponse(cache, tracksUrl);
  const tracks = tracksResponse === null
    ? []
    : await tracksResponse.json() as readonly SubtitleTrack[];
  await Promise.all([
    cacheResponse(cache, thumbnailUrl(entry.rel)).catch(() => null),
    ...tracks.map((track) => (
      cacheResponse(cache, subtitleUrl(entry.rel, track.index, 0)).catch(() => null)
    )),
  ]);
}

function waitForPreparation(signal: AbortSignal): Promise<void> {
  const result = Promise.withResolvers<void>();
  const timer = setTimeout(result.resolve, 1000);
  signal.addEventListener("abort", () => {
    clearTimeout(timer);
    result.reject(new DOMException("Download cancelled", "AbortError"));
  }, { once: true });
  return result.promise;
}

async function readyArtifact(
  initial: OfflineMediaArtifact,
  signal: AbortSignal,
  onProgress: (artifact: OfflineMediaArtifact) => void,
): Promise<OfflineMediaArtifact> {
  onProgress(initial);
  if (initial.status === "queued" || initial.status === "preparing") {
    await waitForPreparation(signal);
    return readyArtifact(await fetchOfflineMediaArtifact(initial.id), signal, onProgress);
  }
  if (initial.status !== "ready" || initial.mediaUrl === null || initial.sizeBytes === null) {
    throw new Error(initial.error ?? "Offline episode preparation failed");
  }
  return initial;
}

async function listOfflineDownloads(): Promise<readonly OfflineDownload[]> {
  const [store, profile] = [offlineStore(), await activeOfflineProfile()];
  if (store === null || profile === null) {
    return [];
  }
  const stored = await store.listDownloads(profile.user.id);
  return mergeOfflineDownloads(stored, trackedOfflineDownloads(profile.user.id));
}

interface DownloadVariables {
  readonly controller: AbortController;
  readonly entry: MediaEntry;
}

async function preparedSource(
  entry: MediaEntry,
  signal: AbortSignal,
  onProgress: (artifact: OfflineMediaArtifact) => void,
) {
  const initial = await prepareOfflineMedia(entry.rel);
  const artifact = await readyArtifact(initial, signal, onProgress);
  const { mediaUrl, sizeBytes } = artifact;
  if (mediaUrl === null || sizeBytes === null) {
    throw new Error("Prepared offline episode is missing its media file");
  }
  const capacity = await prepareOfflineStorage(sizeBytes);
  if (capacity.sufficient === false) {
    throw new Error("This device does not have enough browser storage for the episode");
  }
  return {
    contentType: artifact.mimeType,
    duration: artifact.duration,
    mediaUrl,
    size: sizeBytes,
    version: `"offline-${artifact.id}"`,
  };
}

async function cacheAssetsSafely(entry: MediaEntry): Promise<void> {
  try {
    await cacheOfflineAssets(entry);
  } catch {
    // The episode remains playable when optional artwork or subtitle caching fails.
  }
}

interface DownloadActivity {
  current: OfflineDownload;
}

type ProgressPublisher = (download: OfflineDownload) => void;

function publishDownload(
  activity: DownloadActivity,
  onProgress: ProgressPublisher,
  download: OfflineDownload,
): void {
  activity.current = download;
  trackOfflineDownload(download);
  onProgress(download);
}

function recordPreparationFailure(
  activity: DownloadActivity,
  publish: ProgressPublisher,
  error: unknown,
): void {
  if (activity.current.state !== "preparing") {
    return;
  }
  publish({
    ...activity.current,
    state: error instanceof DOMException && error.name === "AbortError" ? "paused" : "failed",
    updatedAt: Date.now(),
    error: error instanceof Error ? error.message : "Offline episode preparation failed",
  });
}

function stopCompletedActivity(activity: DownloadActivity): void {
  if (activity.current.state !== "preparing" && activity.current.sourceUrl !== "") {
    stopTrackingOfflineDownload(activity.current);
  }
}

async function transferPreparedEpisode(options: {
  readonly activity: DownloadActivity;
  readonly controller: AbortController;
  readonly entry: MediaEntry;
  readonly publish: ProgressPublisher;
  readonly store: OfflineDownloadStore;
  readonly userId: number;
}): Promise<OfflineDownload> {
  const { activity, controller, entry, publish, store, userId } = options;
  const source = await preparedSource(entry, controller.signal, (artifact) => {
    publish({
      ...activity.current,
      preparationProgress: artifact.progress,
      updatedAt: Date.now(),
    });
  });
  const download = await downloadOfflineMedia({
    entry,
    source,
    store,
    userId,
    signal: controller.signal,
    onProgress: publish,
  });
  await cacheAssetsSafely(entry);
  return download;
}

async function runDownload(options: {
  readonly onProgress: ProgressPublisher;
  readonly store: OfflineDownloadStore;
  readonly userId: number;
  readonly variables: DownloadVariables;
}): Promise<OfflineDownload> {
  const { onProgress, store, userId, variables } = options;
  const activity = { current: preparingOfflineDownload(variables.entry, userId) };
  const publish = (download: OfflineDownload): void => publishDownload(activity, onProgress, download);
  publish(activity.current);
  try {
    return await transferPreparedEpisode({ ...variables, activity, publish, store, userId });
  } catch (error: unknown) {
    recordPreparationFailure(activity, publish, error);
    throw error;
  } finally {
    stopCompletedActivity(activity);
  }
}

async function downloadEpisode(
  variables: DownloadVariables,
  onProgress: (download: OfflineDownload) => void,
): Promise<OfflineDownload> {
  const { controller, entry } = variables;
  const [store, profile] = [offlineStore(), await activeOfflineProfile()];
  if (store === null || profile === null) {
    throw new Error("Offline storage is unavailable in this browser");
  }
  preloadPlayer();
  return runDownload({ variables: { controller, entry }, store, userId: profile.user.id, onProgress });
}

export interface OfflineDownloadsState {
  readonly downloads: UseQueryResult<readonly OfflineDownload[], Error>;
  readonly download: UseMutationResult<OfflineDownload, Error, DownloadVariables>;
  readonly remove: UseMutationResult<void, Error, OfflineDownload>;
  readonly start: (entry: MediaEntry) => void;
  readonly cancel: (rel: string) => void;
}

export function useOfflineDownloads(): OfflineDownloadsState {
  const queryClient = useQueryClient();
  const downloads = useQuery({
    queryKey: offlineDownloadsKey,
    queryFn: listOfflineDownloads,
  });
  const updateDownload = useCallback((download: OfflineDownload): void => {
    queryClient.setQueryData<readonly OfflineDownload[]>(offlineDownloadsKey, (current) => (
      updateOfflineDownloadList(current ?? [], download)
    ));
  }, [queryClient]);
  const download = useMutation({
    mutationFn: async (variables: DownloadVariables) => {
      try {
        return await downloadEpisode(variables, updateDownload);
      } finally {
        stopTrackingOfflineController(variables.entry.rel, variables.controller);
      }
    },
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: offlineDownloadsKey }),
      queryClient.invalidateQueries({ queryKey: ["library"] }),
    ]),
  });
  const remove = useMutation({
    mutationFn: async (item: OfflineDownload): Promise<void> => {
      stopTrackingOfflineDownload(item);
      const store = offlineStore();
      if (store !== null) {
        await store.removeDownload(item.id);
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: offlineDownloadsKey }),
        queryClient.invalidateQueries({ queryKey: ["library"] }),
      ]);
    },
  });
  const start = useCallback((entry: MediaEntry): void => {
    const controller = new AbortController();
    trackOfflineController(entry.rel, controller);
    announceOfflineDownload(entry);
    download.mutate({ controller, entry });
  }, [download]);
  const cancel = useCallback((rel: string) => cancelTrackedOfflineDownload(rel), []);
  return { downloads, download, remove, start, cancel };
}
