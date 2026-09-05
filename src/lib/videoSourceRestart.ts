import { hlsUrl } from "../hlsApi.ts";
import type { MediaEntry } from "../types.ts";
import { hlsTimelineOffset } from "./mediaTimeline.ts";
import { attachManagedHls } from "./managedHlsPlayback.ts";

export interface MutableSourceState {
  detach: (() => void) | undefined;
  hiddenAt: number | null;
  recoveryPending: boolean;
  selectedAudio: number | null;
  pendingPosition: number | null;
  readonly playerId: string;
  timelineOffset: number;
  video: HTMLVideoElement | null;
}

export interface RestartOptions {
  readonly audioTrack: number | null;
  readonly entry: MediaEntry;
  readonly position: number;
  readonly setError: (error: string | null) => void;
  readonly setOffset: (offset: number) => void;
  readonly source: MutableSourceState;
}

function stopSource(source: MutableSourceState, setError: (error: string | null) => void): void {
  source.detach?.();
  setError(null);
}

export function restartHls(options: RestartOptions): void {
  const { audioTrack, entry, position, setError, setOffset, source } = options;
  const { video } = source;
  if (video === null) {
    return;
  }
  const timelineOffset = hlsTimelineOffset(position);
  const shouldPlay = !video.paused;
  stopSource(source, setError);
  Object.assign(source, { pendingPosition: position, selectedAudio: audioTrack, timelineOffset });
  setOffset(timelineOffset);
  source.detach = attachManagedHls({
    video,
    url: hlsUrl(entry.rel, audioTrack, position),
    onError: setError,
    resumeAt: position,
    shouldPlay,
    timelineOffset,
  }, source.playerId);
}
