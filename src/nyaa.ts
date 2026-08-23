import { api, unwrap } from "./api.ts";
import type { NyaaSearchResult, NyaaSort, NyaaSortOrder } from "./types.ts";

export interface NyaaSearchOptions {
  readonly search: string;
  readonly category: string;
  readonly trusted: boolean;
  readonly sort: NyaaSort;
  readonly order: NyaaSortOrder;
}

export async function searchNyaa(
  options: NyaaSearchOptions,
  signal: AbortSignal,
): Promise<readonly NyaaSearchResult[]> {
  return unwrap(
    await api.api.torrents.search.get({
      query: {
        q: options.search,
        category: options.category,
        trusted: options.trusted,
        sort: options.sort,
        order: options.order,
      },
      fetch: { signal },
    }),
    "Nyaa search",
  );
}
