export const HLS_SEGMENT_SECONDS = 2;
export const MINIMUM_PLAYBACK_PROGRESS_SECONDS = 30;
export const PLAYBACK_COMPLETION_RATIO = 0.9;
export const PLAYBACK_COMPLETION_REMAINING_SECONDS = 120;

interface PlaybackDurationInput {
  readonly absolutePosition: number;
  readonly knownDuration: number;
  readonly localPosition: number;
  readonly mediaDuration: number;
}

export function resolvedPlaybackDuration(input: PlaybackDurationInput): number {
  const { absolutePosition, knownDuration, localPosition, mediaDuration } = input;
  const timelineDuration = Number.isFinite(mediaDuration)
    ? mediaDuration + absolutePosition - localPosition
    : 0;
  return Math.max(0, timelineDuration, Number.isFinite(knownDuration) ? knownDuration : 0);
}

export function isPlaybackComplete(
  position: number,
  duration: number,
  reportedComplete: boolean,
): boolean {
  const meaningful = position > MINIMUM_PLAYBACK_PROGRESS_SECONDS;
  const nearEnd = duration > 0 &&
    position >= Math.max(
      duration * PLAYBACK_COMPLETION_RATIO,
      duration - PLAYBACK_COMPLETION_REMAINING_SECONDS,
    );
  return meaningful && (reportedComplete || nearEnd);
}
