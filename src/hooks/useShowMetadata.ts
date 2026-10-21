import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { AniListMedia, ShowMetadata } from "../types.ts";
import {
  fetchShowMetadata,
  linkMetadata,
  searchMetadata,
  type MetadataLink,
} from "../metadata.ts";

const metadataQueryKey = ["show-metadata"] as const;

export const showMetadataQuery = queryOptions({
  queryKey: metadataQueryKey,
  queryFn: ({ signal }) => fetchShowMetadata(signal),
});

export function useShowMetadata(): UseQueryResult<ShowMetadata, Error> {
  return useQuery(showMetadataQuery);
}

export function useMetadataSearch(search: string): UseQueryResult<readonly AniListMedia[], Error> {
  return useQuery({
    queryKey: ["metadata-search", search],
    queryFn: ({ signal }) => searchMetadata(search, signal),
    enabled: search.length >= 2,
    staleTime: 300_000,
  });
}

export function useLinkMetadata(): UseMutationResult<
  AniListMedia,
  Error,
  MetadataLink
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (link) => linkMetadata(link),
    onSuccess: (media, { key }) => {
      queryClient.setQueryData<ShowMetadata>(metadataQueryKey, (current) => ({
        ...current,
        [key]: media,
      }));
    },
  });
}
