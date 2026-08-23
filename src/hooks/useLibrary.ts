import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { MediaEntry } from "../types.ts";
import { fetchLibrary } from "../api.ts";

export function useLibrary(): UseQueryResult<readonly MediaEntry[], Error> {
  return useQuery({
    queryKey: ["library"],
    queryFn: ({ signal }) => fetchLibrary(signal),
  });
}
