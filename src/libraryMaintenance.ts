import { api, unwrap } from "./api.ts";
import type { LibraryStatus, MetadataRefreshStatus } from "./types.ts";

export async function fetchLibraryStatus(signal: AbortSignal): Promise<LibraryStatus> {
  return unwrap(
    await api.api.library.status.get({ fetch: { signal } }),
    "Library status request",
  );
}

export async function refreshLibrary(): Promise<LibraryStatus> {
  return unwrap(await api.api.library.refresh.post(), "Refreshing library");
}

export async function fetchMetadataRefreshStatus(
  signal: AbortSignal,
): Promise<MetadataRefreshStatus> {
  return unwrap(
    await api.api.metadata.refresh.get({ fetch: { signal } }),
    "Metadata refresh status request",
  );
}

export async function refreshMetadata(): Promise<MetadataRefreshStatus> {
  return unwrap(await api.api.metadata.refresh.post(), "Refreshing metadata");
}
