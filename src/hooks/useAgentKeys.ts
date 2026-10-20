import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { createAgentKey, fetchAgentKeys, revokeAgentKey, type AgentKeysOverview, type CreatedAgentKey } from "../agentKeysApi.ts";

export const agentKeysKey = ["agent-keys"] as const;

export function useAgentKeys(): UseQueryResult<AgentKeysOverview, Error> {
  return useQuery({ queryKey: agentKeysKey, queryFn: ({ signal }) => fetchAgentKeys(signal) });
}

export function useCreateAgentKey(): UseMutationResult<CreatedAgentKey, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAgentKey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: agentKeysKey }),
  });
}

export function useRevokeAgentKey(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeAgentKey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: agentKeysKey }),
  });
}
