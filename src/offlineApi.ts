import { api, unwrap } from "./api.ts";
import type { OfflineMediaArtifact } from "./types.ts";

export async function prepareOfflineMedia(path: string): Promise<OfflineMediaArtifact> {
  const response = await api.api["offline-media"].post({ path });
  return unwrap(response, "Preparing offline episode");
}

export async function fetchOfflineMediaArtifact(id: string): Promise<OfflineMediaArtifact> {
  const response = await api.api["offline-media"]({ id }).get();
  return unwrap(response, "Checking offline episode preparation");
}
