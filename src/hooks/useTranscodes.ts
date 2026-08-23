import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelTranscode, deleteTranscode, deleteTranscodeOriginal, fetchTranscodes, startTranscodes } from "../api.ts";
import type { TranscodePreset } from "../types.ts";
import { refreshLibraryCache } from "./refreshLibraryCache.ts";

const key = ["transcodes"] as const;

export function useTranscodes() {
  return useQuery({ queryKey: key, queryFn: ({ signal }) => fetchTranscodes(signal), refetchInterval: 2000 });
}

export function useStartTranscode() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ paths, preset }: { readonly paths: readonly string[]; readonly preset: TranscodePreset }) => startTranscodes(paths, preset),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
}

export function useDeleteTranscode(original: boolean) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await (original ? deleteTranscodeOriginal(id) : deleteTranscode(id));
    },
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: key }),
      refreshLibraryCache(client),
    ]),
  });
}

export function useCancelTranscode() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: cancelTranscode,
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
}
