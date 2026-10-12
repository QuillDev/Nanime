import { audioTracks, chooseAudioTrack } from "./audioTracks.ts";

export { probeDuration } from "./mediaInfo.ts";

export async function selectedAudioIndex(
  abs: string,
  requested: number | null,
  preferredLanguage: string | null,
): Promise<{ readonly index: number | null; readonly requiresSelection: boolean } | undefined> {
  const tracks = await audioTracks(abs);
  if (tracks.length === 0) {
    return requested === null ? { index: null, requiresSelection: false } : undefined;
  }
  const fallback = chooseAudioTrack(tracks, null);
  const selected = chooseAudioTrack(tracks, requested, preferredLanguage);
  return selected === null
    ? undefined
    : { index: selected?.index ?? null, requiresSelection: selected?.index !== fallback?.index };
}
