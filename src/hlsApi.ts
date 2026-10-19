import { hevcPlaybackSupported } from "./lib/hevcPlayback.ts";

export interface HlsPlaybackLease {
  readonly leaseId: string;
  readonly playerId: string;
}

export type HlsReleaseRequest = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function hlsUrl(
  rel: string,
  audioTrack: number | null = null,
  startAt = 0,
): string {
  const query = new URLSearchParams({ path: rel });
  if (hevcPlaybackSupported()) {
    query.set("hevc", "1");
  }
  if (audioTrack !== null) {
    query.set("audio", String(audioTrack));
  }
  if (startAt > 0) {
    query.set("start", String(startAt));
  }
  return `/hls/index?${query.toString()}`;
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
