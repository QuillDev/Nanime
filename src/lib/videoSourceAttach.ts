import { streamUrl } from "../api.ts";
import { hlsUrl } from "../hlsApi.ts";
import type { MediaEntry } from "../types.ts";
import { attachDirectVideoSource } from "./directVideoPlayback.ts";
import { attachManagedHls } from "./managedHlsPlayback.ts";
import { hlsTimelineOffset } from "./mediaTimeline.ts";

export interface SourceAttachment {
  readonly onPassthroughCodec: (codec: string | null) => void;
  readonly video: HTMLVideoElement;
  readonly entry: MediaEntry;
  readonly resumeAt: number;
  readonly onError: (message: string) => void;
  readonly playerId: string;
  readonly direct: boolean;
  readonly onTimelineOffset: (offset: number) => void;
}
export function attachSource(options: SourceAttachment): (() => void) | undefined {
  const { video, entry, resumeAt, onError, playerId, direct, onTimelineOffset, onPassthroughCodec } = options;
  if (direct) {
    attachDirectVideoSource(video, entry.offlineUrl ?? streamUrl(entry.rel));
    return undefined;
  }
  const timelineOffset = hlsTimelineOffset(resumeAt);
  return attachManagedHls({
    video,
    url: hlsUrl(entry.rel, null, resumeAt),
    onError,
    resumeAt,
    timelineOffset,
    onTimelineOffset,
    onPassthroughCodec,
  }, playerId);
}
