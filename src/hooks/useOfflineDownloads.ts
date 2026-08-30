import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import type { MediaEntry, OfflineMediaArtifact, SubtitleTrack } from "../types.ts";
import { downloadOfflineMedia } from "../offline/download.ts";
import { prepareOfflineStorage } from "../offline/capacity.ts";
import type { OfflineDownload } from "../offline/types.ts";
import { activeOfflineProfile, offlineStore } from "../offline/runtime.ts";
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
): Promise<OfflineMediaArtifact> {
  if (initial.status === "queued" || initial.status === "preparing") {
    await waitForPreparation(signal);
    return readyArtifact(await fetchOfflineMediaArtifact(initial.id), signal);
  }
  if (initial.status !== "ready" || initial.mediaUrl === null || initial.sizeBytes === null) {
    throw new Error(initial.error ?? "Offline episode preparation failed");
  }
  return initial;
}

async function listOfflineDownloads(): Promise<readonly OfflineDownload[]> {
  const [store, profile] = [offlineStore(), await activeOfflineProfile()];
  return store === null || profile === null ? [] : store.listDownloads(profile.user.id);
}

interface DownloadVariables {
  readonly controller: AbortController;
  readonly entry: MediaEntry;
}

async function preparedSource(entry: MediaEntry, signal: AbortSignal) {
  const initial = await prepareOfflineMedia(entry.rel);
  const artifact = await readyArtifact(initial, signal);
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
  const source = await preparedSource(entry, controller.signal);
  const download = await downloadOfflineMedia({
    entry,
    source,
    store,
    userId: profile.user.id,
    signal: controller.signal,
    onProgress,
  });
  await cacheAssetsSafely(entry);
  return download;
}

export interface OfflineDownloadsState {
  readonly downloads: UseQueryResult<readonly OfflineDownload[], Error>;
  readonly download: UseMutationResult<OfflineDownload, Error, DownloadVariables>;
  readonly remove: UseMutationResult<void, Error, OfflineDownload>;
  readonly start: (entry: MediaEntry) => void;
  readonly cancel: () => void;
}

export function useOfflineDownloads(): OfflineDownloadsState {
  const queryClient = useQueryClient();
  const controllerRef = useRef<AbortController | null>(null);
  const downloads = useQuery({
    queryKey: offlineDownloadsKey,
    queryFn: listOfflineDownloads,
  });
  const updateDownload = useCallback((download: OfflineDownload): void => {
    queryClient.setQueryData<readonly OfflineDownload[]>(offlineDownloadsKey, (current) => [
      download,
      ...(current ?? []).filter((item) => item.id !== download.id),
    ]);
  }, [queryClient]);
  const download = useMutation({
    mutationFn: (variables: DownloadVariables) => downloadEpisode(variables, updateDownload),
    onSettled: () => {
      controllerRef.current = null;
      return queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });
  const remove = useMutation({
    mutationFn: async (item: OfflineDownload): Promise<void> => {
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
    controllerRef.current = controller;
    download.mutate({ controller, entry });
  }, [download]);
  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  return { downloads, download, remove, start, cancel };
}
