import { av1PlaybackSupported, hevcPlaybackSupported } from "./lib/hevcPlayback.ts";
import { convertedStreamPreferred } from "./lib/streamPreference.ts";

export interface HlsPlaybackLease {
  readonly leaseId: string;
  readonly playerId: string;
}

export type HlsReleaseRequest = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Asks for the converted stream when the viewer chose it, otherwise says which codecs play untouched. */
function videoChoice(): [string, string][] {
  if (convertedStreamPreferred()) {
    return [["convert", "1"]];
  }
  const flags: [string, string][] = [];
  if (hevcPlaybackSupported()) {
    flags.push(["hevc", "1"]);
  }
  if (av1PlaybackSupported()) {
    flags.push(["av1", "1"]);
  }
  return flags;
}

export function hlsUrl(
  rel: string,
  audioTrack: number | null = null,
  startAt = 0,
): string {
  const query = new URLSearchParams([["path", rel], ...videoChoice()]);
  if (audioTrack !== null) {
    query.set("audio", String(audioTrack));
  }
  if (startAt > 0) {
    query.set("start", String(startAt));
  }
  return `/hls/index?${query.toString()}`;
}

type SecondRange = readonly [number, number];

/** What's converted of an episode (kept on the server) and what's converting right now, in seconds. */
export interface ConvertedProgress {
  readonly duration: number;
  readonly kept: readonly SecondRange[];
  readonly converting: readonly SecondRange[];
}

function secondRanges(value: unknown): readonly SecondRange[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((range: unknown): SecondRange[] => (
    Array.isArray(range) && typeof range[0] === "number" && typeof range[1] === "number" ? [[range[0], range[1]]] : []
  ));
}

export async function fetchConvertedProgress(rel: string, audioTrack: number | null, signal: AbortSignal): Promise<ConvertedProgress> {
  const query = new URLSearchParams({ path: rel });
  if (audioTrack !== null) {
    query.set("audio", String(audioTrack));
  }
  const response = await fetch(`/hls/converted?${query.toString()}`, { credentials: "same-origin", signal });
  if (!response.ok) {
    throw new Error(`Converted progress request failed with ${String(response.status)}`);
  }
  const body: unknown = await response.json();
  const fields = typeof body === "object" && body !== null ? new Map(Object.entries(body)) : new Map<string, unknown>();
  const duration = fields.get("duration");
  return {
    duration: typeof duration === "number" ? duration : 0,
    kept: secondRanges(fields.get("kept")),
    converting: secondRanges(fields.get("converting")),
  };
}

export function leasedHlsUrl(url: string, lease: HlsPlaybackLease): string {
  const parsed = new URL(url, "https://nanime.invalid");
  parsed.searchParams.set("player", lease.playerId);
  parsed.searchParams.set("lease", lease.leaseId);
  return `${parsed.pathname}${parsed.search}`;
}

export async function releaseHlsPlayback(
  lease: HlsPlaybackLease,
  request: HlsReleaseRequest = fetch,
): Promise<void> {
  const query = new URLSearchParams({ player: lease.playerId, lease: lease.leaseId });
  const response = await request(`/api/hls/release?${query.toString()}`, {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
  });
  if (!response.ok) {
    throw new Error(`HLS playback release failed with HTTP ${String(response.status)}`);
  }
}
