import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { AniListMedia, ShowMetadata } from "../types.ts";
import { fetchShowMetadata, linkAniList, searchAniList } from "../api.ts";

const metadataQueryKey = ["show-metadata"] as const;

export function useShowMetadata(): UseQueryResult<ShowMetadata, Error> {
  return useQuery({
    queryKey: metadataQueryKey,
    queryFn: ({ signal }) => fetchShowMetadata(signal),
  });
}

export function useAniListSearch(
  search: string,
): UseQueryResult<readonly AniListMedia[], Error> {
  return useQuery({
    queryKey: ["anilist-search", search],
    queryFn: ({ signal }) => searchAniList(search, signal),
    enabled: search.length >= 2,
    staleTime: 300_000,
  });
}

interface LinkVariables {
  readonly key: string;
  readonly id: number;
}

export function useLinkAniList(): UseMutationResult<
  AniListMedia,
  Error,
  LinkVariables
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, id }) => linkAniList(key, id),
    onSuccess: (media, { key }) => {
      queryClient.setQueryData<ShowMetadata>(metadataQueryKey, (current) => ({
        ...current,
        [key]: media,
      }));
    },
  });
}
