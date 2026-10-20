import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import {
  downloadEpisodes, fetchSourceSettings, fetchSourceShow, fetchSources, searchSource,
  type SourceEpisode, type SourceResult, type SourceSetting, type SourceShow, type SourcesOverview,
} from "../sourcesApi.ts";
import { downloadsKey } from "./useDownloads.ts";

export const sourcesKey = ["sources"] as const;

export function useSources(): UseQueryResult<SourcesOverview, Error> {
  return useQuery({ queryKey: sourcesKey, queryFn: ({ signal }) => fetchSources(signal) });
}

export function useSourceSearch(id: string, query: string): UseQueryResult<readonly SourceResult[], Error> {
  return useQuery({
    queryKey: ["source-search", id, query],
    queryFn: ({ signal }) => searchSource(id, query, signal),
    enabled: id !== "" && query !== "",
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useSourceShow(id: string, url: string | null): UseQueryResult<SourceShow, Error> {
  return useQuery({
    queryKey: ["source-show", id, url],
    queryFn: ({ signal }) => fetchSourceShow(id, url ?? "", signal),
    enabled: id !== "" && url !== null,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useSourceSettings(id: string, enabled: boolean): UseQueryResult<readonly SourceSetting[], Error> {
  return useQuery({ queryKey: ["source-settings", id], queryFn: ({ signal }) => fetchSourceSettings(id, signal), enabled, retry: false });
}

/** Any change to repositories, installs or settings; refreshes what it affects. */
export function useSourceChange<T>(change: (input: T) => Promise<void>): UseMutationResult<void, Error, T> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: sourcesKey }),
      queryClient.invalidateQueries({ queryKey: ["source-settings"] }),
      queryClient.invalidateQueries({ queryKey: ["source-search"] }),
    ]),
  });
}

interface EpisodeDownload {
  readonly id: string;
  readonly showFolder: string;
  readonly episodes: readonly SourceEpisode[];
}

export function useEpisodeDownload(): UseMutationResult<number, Error, EpisodeDownload> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, showFolder, episodes }) => downloadEpisodes(id, showFolder, episodes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: downloadsKey }),
  });
}
