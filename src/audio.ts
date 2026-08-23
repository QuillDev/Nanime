import { api, unwrap } from "./api.ts";
import type { AudioTrack } from "./types.ts";

export async function fetchAudioTracks(
  rel: string,
  signal: AbortSignal,
): Promise<readonly AudioTrack[]> {
  return unwrap(
    await api.api["audio-tracks"].get({ query: { path: rel }, fetch: { signal } }),
    "Audio tracks request",
  );
}
