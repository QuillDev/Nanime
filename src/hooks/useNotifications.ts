import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTranscodes } from "../api.ts";
import { fetchDownloads } from "../downloadActions.ts";
import { groupShows, partitionShowsByMetadata, type ShowGroup } from "../lib/library.ts";
import { collectNotifications, type Notifications } from "../lib/notifications.ts";
import { useLibrary } from "./useLibrary.ts";
import { useShowMetadata } from "./useShowMetadata.ts";
import { downloadsKey } from "./useDownloads.ts";

const POLL_MS = 10_000;
const NO_SHOWS: readonly ShowGroup[] = [];

/** Unmatched shows (once metadata has loaded, so nothing flashes as unmatched), downloads and transcodes. */
export function useNotifications(): Notifications {
  const library = useLibrary();
  const metadata = useShowMetadata();
  const downloads = useQuery({ queryKey: downloadsKey, queryFn: ({ signal }) => fetchDownloads(signal), refetchInterval: POLL_MS });
  const jobs = useQuery({ queryKey: ["transcodes"], queryFn: ({ signal }) => fetchTranscodes(signal), refetchInterval: POLL_MS });
  const unmapped = useMemo(() => (
    library.data === undefined || metadata.data === undefined
      ? NO_SHOWS
      : partitionShowsByMetadata(groupShows(library.data, metadata.data), metadata.data).unmapped
  ), [library.data, metadata.data]);
  return useMemo(() => collectNotifications({
    unmapped,
    downloads: downloads.data?.downloads ?? [],
    jobs: jobs.data ?? [],
  }), [unmapped, downloads.data, jobs.data]);
}
