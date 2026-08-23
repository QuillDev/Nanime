import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { searchNyaa } from "../api.ts";
import type { NyaaSearchResult } from "../types.ts";

export function useNyaaSearch(
  search: string,
  category: string,
  trusted: boolean,
): UseQueryResult<readonly NyaaSearchResult[], Error> {
  return useQuery({
    queryKey: ["nyaa-search", search, category, trusted],
    queryFn: ({ signal }) => searchNyaa({ search, category, trusted }, signal),
    enabled: search.length >= 2,
    staleTime: 60_000,
  });
}
