import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  attachPlaybackDiagnostics,
  bufferedRanges,
  CAPTURE_WINDOW_MS,
  type DiagnosticRecord,
  networkStateName,
  playbackQuality,
  readyStateName,
  SEGMENT_SECONDS,
} from "../lib/playbackDiagnosticCapture.ts";

function displayMode(): string {
  if (globalThis.matchMedia("(display-mode: fullscreen)").matches) {
    return "fullscreen";
  }
  return globalThis.matchMedia("(display-mode: standalone)").matches
    ? "standalone"
    : "browser";
}

function recordLine(record: DiagnosticRecord): string {
  return `${new Date(record.atMs).toISOString()} | ${record.kind} | ${record.detail}`;
}

function gapSummary(records: readonly DiagnosticRecord[]): string {
  const gaps = records.filter((record) => record.wallGapMs !== undefined);
  const boundaries = gaps.filter((record) => record.segmentBoundary === true);
  const values = gaps.flatMap((record) => record.wallGapMs === undefined ? [] : [record.wallGapMs]);
  const boundaryValues = boundaries.flatMap((record) => (
    record.wallGapMs === undefined ? [] : [record.wallGapMs]
  ));
  const maximum = values.length === 0 ? 0 : Math.max(...values);
  const boundaryMaximum = boundaryValues.length === 0 ? 0 : Math.max(...boundaryValues);
  return `captured=${String(gaps.length)}, max=${maximum.toFixed(1)}ms, segmentBoundaries=${String(boundaries.length)}, boundaryMax=${boundaryMaximum.toFixed(1)}ms`;
}

interface ReportOptions {
  readonly buffering: boolean;
  readonly frozenFrameVisible: boolean;
  readonly generatedAt: number;
  readonly playbackMode: "direct" | "hls";
  readonly records: readonly DiagnosticRecord[];
  readonly video: HTMLVideoElement;
}

function formatReport(options: ReportOptions): string {
  const { buffering, frozenFrameVisible, generatedAt, playbackMode, records, video } = options;
  return [
    "Nanime playback diagnostic",
    `Generated: ${new Date(generatedAt).toISOString()}`,
    `Capture window: last ${String(CAPTURE_WINDOW_MS / 1000)} seconds`,
    `Playback mode: ${playbackMode}`,
    `Native HLS: ${String(video.canPlayType("application/vnd.apple.mpegurl") !== "")}`,
    `Expected HLS segment length: ${String(SEGMENT_SECONDS)} seconds`,
    `Display mode: ${displayMode()}`,
    `Online: ${String(navigator.onLine)}`,
    `Visibility: ${document.visibilityState}`,
    `Viewport: ${String(globalThis.innerWidth)}x${String(globalThis.innerHeight)} @ ${String(globalThis.devicePixelRatio)}`,
    `Browser: ${navigator.userAgent}`,
    `Buffering UI: ${String(buffering)}`,
    `Frozen frame UI: ${String(frozenFrameVisible)}`,
    `Current time: ${video.currentTime.toFixed(3)}`,
    `Duration: ${Number.isFinite(video.duration) ? video.duration.toFixed(3) : "unknown"}`,
    `Paused: ${String(video.paused)}`,
    `Ended: ${String(video.ended)}`,
    `Seeking: ${String(video.seeking)}`,
    `Playback rate: ${video.playbackRate.toFixed(2)}`,
    `Ready state: ${readyStateName(video.readyState)} (${String(video.readyState)})`,
    `Network state: ${networkStateName(video.networkState)} (${String(video.networkState)})`,
    `Buffered ranges: ${bufferedRanges(video)}`,
    `Video size: ${String(video.videoWidth)}x${String(video.videoHeight)}`,
    `Element size: ${String(video.clientWidth)}x${String(video.clientHeight)}`,
    `Playback quality: ${playbackQuality(video)}`,
    `Frame gap summary: ${gapSummary(records)}`,
    "Recent timeline (chronological):",
    ...(records.length === 0 ? ["none"] : records.map((record) => recordLine(record))),
  ].join("\n");
}

export function usePlaybackDiagnostics(
  videoRef: RefObject<HTMLVideoElement | null>,
  playbackMode: "direct" | "hls",
) {
  const recordsRef = useRef<DiagnosticRecord[]>([]);

  useEffect(() => {
    const video = videoRef.current;
    return video === null ? undefined : attachPlaybackDiagnostics(video, recordsRef);
  }, [videoRef]);

  return useCallback((buffering: boolean, frozenFrameVisible: boolean): string => {
    const video = videoRef.current;
    if (video === null) {
      return "Nanime playback diagnostic\nVideo element unavailable.";
    }
    const generatedAt = Date.now();
    const records = recordsRef.current.filter((record) => (
      record.atMs >= generatedAt - CAPTURE_WINDOW_MS
    ));
    return formatReport({
      buffering,
      frozenFrameVisible,
      generatedAt,
      playbackMode,
      records,
      video,
    });
  }, [playbackMode, videoRef]);
}
