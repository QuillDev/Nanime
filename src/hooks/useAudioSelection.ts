import { useCallback, useState } from "react";
import type { AudioTrack } from "../types.ts";
import { useAudioTracks } from "./useAudioTracks.ts";
import { audioLanguageMatches, type PreferredAudioLanguage } from "../../shared/audioLanguage.ts";

const EMPTY_AUDIO_TRACKS: readonly AudioTrack[] = [];

interface AudioSelection {
  readonly error: Error | null;
  readonly tracks: readonly AudioTrack[];
  readonly selectedTrack: number | null;
  readonly handleTrack: (index: number) => void;
}

interface AudioSelectionOptions {
  readonly enabled?: boolean;
  readonly preferredLanguage?: PreferredAudioLanguage | null;
}

export function useAudioSelection(
  rel: string,
  onTrack: (index: number) => void,
  options: AudioSelectionOptions = {},
): AudioSelection {
  const { enabled = true, preferredLanguage = null } = options;
  const audio = useAudioTracks(rel, enabled);
  const [selection, setSelection] = useState<number | null>(null);
  const tracks = audio.data ?? EMPTY_AUDIO_TRACKS;
  const selectedTrack = selection ??
    (preferredLanguage === null
      ? undefined
      : tracks.find((track) => audioLanguageMatches(track.language, preferredLanguage))?.index) ??
    tracks.find((track) => track.isDefault)?.index ??
    tracks[0]?.index ?? null;
  const handleTrack = useCallback((index: number) => {
    setSelection(index);
    onTrack(index);
  }, [onTrack]);
  return {
    error: audio.error,
    tracks,
    selectedTrack,
    handleTrack,
  };
}
