import { api, unwrap } from "./api.ts";
import type { LibraryActivityEvent } from "./types.ts";

export async function fetchLibraryActivity(
  signal: AbortSignal,
): Promise<readonly LibraryActivityEvent[]> {
  return unwrap(
    await api.api.library.activity.get({
      query: { limit: "50" },
      fetch: { signal },
    }),
    "Library activity request",
  );
}
