import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  AniListAccountStatus,
  AniListAuthConfig,
  AniListListEntry,
} from "../types.ts";
import {
  type AniListListUpdate,
  disconnectAniList,
  fetchAniListAccount,
  fetchAniListAuthConfig,
  fetchAniListListEntry,
  updateAniListListEntry,
} from "../api.ts";

const accountKey = ["anilist-account"] as const;

export function useAniListAuthConfig(): UseQueryResult<AniListAuthConfig, Error> {
  return useQuery({
    queryKey: ["anilist-auth-config"],
    queryFn: ({ signal }) => fetchAniListAuthConfig(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useAniListAccount(): UseQueryResult<AniListAccountStatus, Error> {
  return useQuery({
    queryKey: accountKey,
    queryFn: ({ signal }) => fetchAniListAccount(signal),
  });
}

export function useDisconnectAniList(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disconnectAniList,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: accountKey });
      queryClient.removeQueries({ queryKey: ["anilist-list"] });
    },
  });
}

export function useAniListListEntry(
  mediaId: number,
  enabled: boolean,
): UseQueryResult<AniListListEntry | null, Error> {
  return useQuery({
    queryKey: ["anilist-list", mediaId],
    queryFn: ({ signal }) => fetchAniListListEntry(mediaId, signal),
    enabled,
  });
}

interface UpdateVariables {
  readonly mediaId: number;
  readonly update: AniListListUpdate;
}

export function useUpdateAniListListEntry(): UseMutationResult<
  AniListListEntry,
  Error,
  UpdateVariables
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ mediaId, update }) => updateAniListListEntry(mediaId, update),
    onSuccess: (entry) => {
      queryClient.setQueryData(["anilist-list", entry.mediaId], entry);
    },
  });
}
