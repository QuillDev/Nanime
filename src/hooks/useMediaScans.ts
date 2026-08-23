import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMediaScans, startMediaScans } from "../api.ts";

const key = ["media-scans"] as const;

export function useMediaScans() {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchMediaScans(signal),
    refetchInterval: 2000,
  });
}

export function useStartMediaScans() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: startMediaScans,
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
}
