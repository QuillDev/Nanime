import { useCallback, useState } from "react";
import type { AudioTrack } from "../types.ts";
import { useAudioTracks } from "./useAudioTracks.ts";

const EMPTY_AUDIO_TRACKS: readonly AudioTrack[] = [];

interface AudioSelection {
  readonly error: Error | null;
  readonly tracks: readonly AudioTrack[];
  readonly selectedTrack: number | null;
  readonly handleTrack: (index: number) => void;
}

export function useAudioSelection(
  rel: string,
  onTrack: (index: number) => void,
): AudioSelection {
  const audio = useAudioTracks(rel);
  const [selection, setSelection] = useState<number | null>(null);
  const tracks = audio.data ?? EMPTY_AUDIO_TRACKS;
  const selectedTrack = selection ??
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
