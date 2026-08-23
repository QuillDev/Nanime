import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { searchNyaa, type NyaaSearchOptions } from "../nyaa.ts";
import type { NyaaSearchResult } from "../types.ts";

export function useNyaaSearch(
  options: NyaaSearchOptions,
): UseQueryResult<readonly NyaaSearchResult[], Error> {
  return useQuery({
    queryKey: ["nyaa-search", options],
    queryFn: ({ signal }) => searchNyaa(options, signal),
    enabled: options.search.length >= 2,
    staleTime: 60_000,
  });
}
