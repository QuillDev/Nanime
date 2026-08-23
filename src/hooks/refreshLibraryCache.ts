import type { QueryClient } from "@tanstack/react-query";
import { refreshLibrary } from "../libraryMaintenance.ts";

export async function refreshLibraryCache(client: QueryClient): Promise<void> {
  const status = await refreshLibrary();
  client.setQueryData(["library-status"], status);
  await client.invalidateQueries({ queryKey: ["library"] });
}
