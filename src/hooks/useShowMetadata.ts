import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { AniListMedia, MetadataProvider, ShowMetadata } from "../types.ts";
import {
  fetchShowMetadata,
  linkMetadata,
  searchMetadata,
  updateMetadataAniListId,
} from "../metadata.ts";

const metadataQueryKey = ["show-metadata"] as const;

export function useShowMetadata(): UseQueryResult<ShowMetadata, Error> {
  return useQuery({
    queryKey: metadataQueryKey,
    queryFn: ({ signal }) => fetchShowMetadata(signal),
  });
}

export function useMetadataSearch(
  provider: MetadataProvider,
  search: string,
): UseQueryResult<readonly AniListMedia[], Error> {
  return useQuery({
    queryKey: ["metadata-search", provider, search],
    queryFn: ({ signal }) => searchMetadata(provider, search, signal),
    enabled: search.length >= 2,
    staleTime: 300_000,
  });
}

interface LinkVariables {
  readonly provider: MetadataProvider;
  readonly key: string;
  readonly id: number;
  readonly anilistId: number | null;
  readonly manualTitle?: string;
}

export function useLinkMetadata(): UseMutationResult<
  AniListMedia,
  Error,
  LinkVariables
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

interface AniListIdVariables {
  readonly key: string;
  readonly anilistId: number | null;
}

export function useUpdateMetadataAniListId(): UseMutationResult<
  AniListMedia,
  Error,
  AniListIdVariables
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, anilistId }) => updateMetadataAniListId(key, anilistId),
    onSuccess: (media, { key }) => {
      queryClient.setQueryData<ShowMetadata>(metadataQueryKey, (current) => ({
        ...current,
        [key]: media,
      }));
    },
  });
}
