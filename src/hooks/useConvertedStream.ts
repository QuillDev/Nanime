import { useCallback, useMemo, useState } from "react";
import { useStreamChoiceEnabled } from "../lib/streamChoicePreference.ts";
import { convertedStreamPreferred, setConvertedStreamPreferred } from "../lib/streamPreference.ts";
import { restartDirect, restartHls, seekTimeline, type MutableSourceState } from "../lib/videoSourceRestart.ts";
import { useHlsBackgroundRecovery } from "./useHlsBackgroundRecovery.ts";
import type { MediaEntry, PreferredAudioLanguage } from "../types.ts";

/** Whether the file plays as-is in the browser, without HLS. */
export function playsDirect(entry: MediaEntry, preferredAudioLanguage: PreferredAudioLanguage | null, converted: boolean): boolean {
  return entry.offlineUrl !== undefined || (entry.direct && preferredAudioLanguage === null && !converted);
}

export function initiallyDirect(entry: MediaEntry, preferredAudioLanguage: PreferredAudioLanguage | null): boolean {
  return playsDirect(entry, preferredAudioLanguage, convertedStreamPreferred());
}

interface ConvertedStreamOptions {
  readonly entry: MediaEntry;
  readonly preferredAudioLanguage: PreferredAudioLanguage | null;
  readonly playbackPosition: (video: HTMLVideoElement) => number;
  readonly setError: (error: string | null) => void;
  readonly setOffset: (offset: number) => void;
  readonly sourceRef: React.RefObject<MutableSourceState>;
}

/** The original-or-converted choice: switching picks playback back up at the same spot. */
function useConvertedStream(options: ConvertedStreamOptions) {
  const { entry, preferredAudioLanguage, playbackPosition, setError, setOffset, sourceRef } = options;
  const [converted, setConverted] = useState(convertedStreamPreferred);
  const handleConverted = useCallback((next: boolean) => {
    setConvertedStreamPreferred(next);
    setConverted(next);
    const source = sourceRef.current;
    if (source.video === null) {
      return;
    }
    const position = playbackPosition(source.video);
    if (playsDirect(entry, preferredAudioLanguage, next) && source.selectedAudio === null) {
      restartDirect({ entry, position, setError, setOffset, source });
    } else {
      restartHls({ audioTrack: source.selectedAudio, entry, position, setError, setOffset, source });
    }
  }, [entry, playbackPosition, preferredAudioLanguage, setError, setOffset, sourceRef]);
  return { converted, handleConverted };
}

interface BackgroundRestartOptions {
  readonly direct: boolean;
  readonly entry: MediaEntry;
  readonly playbackPosition: (video: HTMLVideoElement) => number;
  readonly setError: (error: string | null) => void;
  readonly setOffset: (offset: number) => void;
  readonly sourceRef: React.RefObject<MutableSourceState>;
}

function useBackgroundRestart(options: BackgroundRestartOptions): void {
  const { direct, entry, playbackPosition, setError, setOffset, sourceRef } = options;
  const recover = useCallback((video: HTMLVideoElement) => {
    restartHls({
      audioTrack: sourceRef.current.selectedAudio, entry,
      position: playbackPosition(video), setError, setOffset,
      source: sourceRef.current,
    });
  }, [entry, playbackPosition, setError, setOffset, sourceRef]);
  useHlsBackgroundRecovery({ enabled: !direct, onRecover: recover, sourceRef });
}

/**
 * How the player gets its video and moves around in it: as-is or over HLS,
 * original or converted. Seeks and background recovery follow the current choice.
 */
export function useSourceSwitching(options: ConvertedStreamOptions) {
  const { entry, preferredAudioLanguage, setError, setOffset, sourceRef } = options;
  const { converted, handleConverted } = useConvertedStream(options);
  const direct = playsDirect(entry, preferredAudioLanguage, converted);
  useBackgroundRestart({ ...options, direct });
  const handleTimelineSeek = useCallback((position: number): void => {
    seekTimeline({ direct, entry, position, setError, setOffset, source: sourceRef.current });
  }, [direct, entry, setError, setOffset, sourceRef]);
  // The choice shows only once turned on under Advanced in the profile, and never for offline copies.
  const choiceEnabled = useStreamChoiceEnabled();
  const stream = useMemo(
    () => (choiceEnabled && entry.offlineUrl === undefined ? { converted, onConverted: handleConverted } : null),
    [choiceEnabled, converted, entry.offlineUrl, handleConverted],
  );
  return { direct, handleTimelineSeek, stream };
}
