import type { RefObject } from "react";
import { HLS_SEGMENT_SECONDS } from "../../shared/playback.ts";

const CAPTURED_EVENTS = [
  "abort", "canplay", "canplaythrough", "durationchange", "emptied", "ended", "error",
  "loadeddata", "loadedmetadata", "loadstart", "pause", "play", "playing", "progress",
  "ratechange", "seeked", "seeking", "stalled", "suspend", "timeupdate", "waiting",
] as const;
export const CAPTURE_WINDOW_MS = 120_000;
export const SEGMENT_SECONDS = HLS_SEGMENT_SECONDS;
const FRAME_GAP_MS = 120;
const MAX_RECORDS = 1000;
const SAMPLE_INTERVAL_MS = 1000;

export interface DiagnosticRecord {
  readonly atMs: number;
  readonly kind: string;
  readonly detail: string;
  readonly wallGapMs?: number;
  readonly segmentBoundary?: boolean;
}

interface PreviousFrame {
  readonly callbackAt: number;
  readonly mediaTime: number;
  readonly presentedFrames: number;
}

interface FrameObservation {
  readonly callbackAt: number;
  readonly frameJump: number;
  readonly mediaGap: number;
  readonly metadata: VideoFrameCallbackMetadata;
  readonly segmentBoundary: boolean;
  readonly video: HTMLVideoElement;
  readonly wallGapMs: number;
}

interface FrameObservationInput {
  readonly callbackAt: number;
  readonly metadata: VideoFrameCallbackMetadata;
  readonly previous: PreviousFrame;
  readonly video: HTMLVideoElement;
}

export function bufferedAhead(video: HTMLVideoElement): number {
  let index = 0;
  while (index < video.buffered.length) {
    if (video.buffered.start(index) <= video.currentTime &&
      video.buffered.end(index) >= video.currentTime) {
      return video.buffered.end(index) - video.currentTime;
    }
    index += 1;
  }
  return 0;
}

export function bufferedRanges(video: HTMLVideoElement): string {
  const ranges: string[] = [];
  let index = 0;
  while (index < video.buffered.length) {
    ranges.push(`${video.buffered.start(index).toFixed(3)}-${video.buffered.end(index).toFixed(3)}`);
    index += 1;
  }
  return ranges.length === 0 ? "none" : ranges.join(", ");
}

export function readyStateName(value: number): string {
  return ["nothing", "metadata", "current-data", "future-data", "enough-data"][value] ??
    `unknown-${String(value)}`;
}

export function networkStateName(value: number): string {
  return ["empty", "idle", "loading", "no-source"][value] ?? `unknown-${String(value)}`;
}

export function playbackQuality(video: HTMLVideoElement): string {
  if (typeof video.getVideoPlaybackQuality !== "function") {
    return "unavailable";
  }
  const quality = video.getVideoPlaybackQuality();
  return `total=${String(quality.totalVideoFrames)}, dropped=${String(quality.droppedVideoFrames)}`;
}

function mediaState(video: HTMLVideoElement): string {
  return [
    `time=${video.currentTime.toFixed(3)}`,
    `ahead=${bufferedAhead(video).toFixed(3)}`,
    `ready=${readyStateName(video.readyState)}`,
    `network=${networkStateName(video.networkState)}`,
    `paused=${String(video.paused)}`,
    `seeking=${String(video.seeking)}`,
    `rate=${video.playbackRate.toFixed(2)}`,
    `visibility=${document.visibilityState}`,
  ].join(" | ");
}

function appendRecord(recordsRef: RefObject<DiagnosticRecord[]>, record: DiagnosticRecord): void {
  const cutoff = record.atMs - CAPTURE_WINDOW_MS;
  recordsRef.current = [...recordsRef.current, record]
    .filter((item) => item.atMs >= cutoff)
    .slice(-MAX_RECORDS);
}

function recordMediaEvent(
  video: HTMLVideoElement,
  recordsRef: RefObject<DiagnosticRecord[]>,
): (event: Event) => void {
  let lastTimeUpdate = 0;
  return (event: Event): void => {
    const atMs = Date.now();
    if (event.type === "timeupdate" && atMs - lastTimeUpdate < SAMPLE_INTERVAL_MS) {
      return;
    }
    if (event.type === "timeupdate") {
      lastTimeUpdate = atMs;
    }
    const mediaError = event.type === "error" && video.error !== null
      ? ` | mediaError=${String(video.error.code)}:${video.error.message}`
      : "";
    appendRecord(recordsRef, {
      atMs,
      kind: `media:${event.type}`,
      detail: `${mediaState(video)}${mediaError}`,
    });
  };
}

function frameDetail(observation: FrameObservation): string {
  const { callbackAt, frameJump, mediaGap, metadata, video, wallGapMs } = observation;
  const processing = metadata.processingDuration === undefined
    ? "unavailable"
    : `${(metadata.processingDuration * 1000).toFixed(1)}ms`;
  return [
    `time=${metadata.mediaTime.toFixed(3)}`,
    `wallGap=${wallGapMs.toFixed(1)}ms`,
    `mediaGap=${mediaGap.toFixed(3)}s`,
    `frameJump=${String(frameJump)}`,
    `late=${Math.max(0, callbackAt - metadata.expectedDisplayTime).toFixed(1)}ms`,
    `processing=${processing}`,
    `ahead=${bufferedAhead(video).toFixed(3)}`,
    `ready=${readyStateName(video.readyState)}`,
    `visibility=${document.visibilityState}`,
  ].join(" | ");
}

function frameObservation(input: FrameObservationInput): FrameObservation {
  const { callbackAt, metadata, previous, video } = input;
  const mediaGap = metadata.mediaTime - previous.mediaTime;
  const previousSegment = Math.floor(previous.mediaTime / SEGMENT_SECONDS);
  const currentSegment = Math.floor(metadata.mediaTime / SEGMENT_SECONDS);
  return {
    callbackAt,
    frameJump: metadata.presentedFrames - previous.presentedFrames,
    mediaGap,
    metadata,
    segmentBoundary: currentSegment !== previousSegment && mediaGap >= 0 && mediaGap < 1,
    video,
    wallGapMs: callbackAt - previous.callbackAt,
  };
}

function frameRecord(observation: FrameObservation): DiagnosticRecord | null {
  const { frameJump, segmentBoundary, wallGapMs } = observation;
  if (wallGapMs < FRAME_GAP_MS && frameJump <= 1 && !segmentBoundary) {
    return null;
  }
  return {
    atMs: Date.now(),
    kind: segmentBoundary ? "frame:segment-boundary" : "frame:gap",
    detail: frameDetail(observation),
    wallGapMs,
    segmentBoundary,
  };
}

function attachFrameCapture(
  video: HTMLVideoElement,
  recordsRef: RefObject<DiagnosticRecord[]>,
): () => void {
  if (typeof video.requestVideoFrameCallback !== "function") {
    appendRecord(recordsRef, {
      atMs: Date.now(),
      kind: "frames:unsupported",
      detail: "requestVideoFrameCallback is unavailable",
    });
    return () => undefined;
  }
  let previous: PreviousFrame | null = null;
  let frameRequest: number | null = null;
  const captureFrame: VideoFrameRequestCallback = (callbackAt, metadata) => {
    if (previous !== null) {
      const record = frameRecord(frameObservation({ callbackAt, metadata, previous, video }));
      if (record !== null) {
        appendRecord(recordsRef, record);
      }
    }
    previous = { callbackAt, mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames };
    frameRequest = video.requestVideoFrameCallback(captureFrame);
  };
  frameRequest = video.requestVideoFrameCallback(captureFrame);
  return () => {
    if (frameRequest !== null && typeof video.cancelVideoFrameCallback === "function") {
      video.cancelVideoFrameCallback(frameRequest);
    }
  };
}

function attachEnvironmentCapture(recordsRef: RefObject<DiagnosticRecord[]>): () => void {
  const capture = (event: Event): void => {
    appendRecord(recordsRef, {
      atMs: Date.now(),
      kind: `page:${event.type}`,
      detail: `visibility=${document.visibilityState} | online=${String(navigator.onLine)} | viewport=${String(globalThis.innerWidth)}x${String(globalThis.innerHeight)}`,
    });
  };
  const windowEvents = ["online", "offline", "orientationchange", "pagehide", "pageshow", "resize"];
  for (const event of windowEvents) {
    globalThis.addEventListener(event, capture);
  }
  document.addEventListener("visibilitychange", capture);
  return () => {
    for (const event of windowEvents) {
      globalThis.removeEventListener(event, capture);
    }
    document.removeEventListener("visibilitychange", capture);
  };
}

export function attachPlaybackDiagnostics(
  video: HTMLVideoElement,
  recordsRef: RefObject<DiagnosticRecord[]>,
): () => void {
  const captureMedia = recordMediaEvent(video, recordsRef);
  for (const event of CAPTURED_EVENTS) {
    video.addEventListener(event, captureMedia);
  }
  const detachFrames = attachFrameCapture(video, recordsRef);
  const detachEnvironment = attachEnvironmentCapture(recordsRef);
  const sample = globalThis.setInterval(() => {
    if (!video.paused && !video.ended) {
      appendRecord(recordsRef, {
        atMs: Date.now(),
        kind: "sample",
        detail: `${mediaState(video)} | quality=${playbackQuality(video)}`,
      });
    }
  }, SAMPLE_INTERVAL_MS);
  return () => {
    for (const event of CAPTURED_EVENTS) {
      video.removeEventListener(event, captureMedia);
    }
    globalThis.clearInterval(sample);
    detachFrames();
    detachEnvironment();
  };
}
