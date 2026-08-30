import { useQuery } from "@tanstack/react-query";
import { fetchLibraryActivity } from "../libraryActivityApi.ts";

export function useLibraryActivity() {
  return useQuery({
    queryKey: ["library-activity"],
    queryFn: ({ signal }) => fetchLibraryActivity(signal),
  });
}
