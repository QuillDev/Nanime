import { basename } from "node:path";

import type { AudioTrack } from "./audioTracks.ts";
import { startPassthrough } from "./hlsPassthrough.ts";
import type { HlsProducer } from "./hlsProcess.ts";
import { startCachedTranscode } from "./hlsSegmentCache.ts";
import type { HlsStreamSource } from "./hlsTranscode.ts";

interface OnDemandOptions {
  readonly source: HlsStreamSource;
  readonly audioTrack: AudioTrack | undefined;
  readonly directory: string;
  readonly duration: number;
}

/** Sources whose playlist spans the whole episode and whose segments are made on request. */
export function onDemand(source: HlsStreamSource): boolean {
  return source.videoMode === "passthrough" || source.videoMode === "cached";
}

export function startOnDemand(options: OnDemandOptions): Promise<HlsProducer> {
  const { source, audioTrack, directory, duration } = options;
  return source.videoMode === "cached" && source.cacheRoot !== undefined
    ? startCachedTranscode({ input: source.input, audioTrack, cacheRoot: source.cacheRoot, directory, duration })
    : startPassthrough({ input: source.input, audioTrack, directory, duration, codec: source.codec });
}

const MAP_URI = /^#EXT-X-MAP:URI="(?<uri>[^"]+)"/u;

function segmentUrl(name: string, sessionId: string, leaseId: string | null): string {
  const lease = leaseId === null ? "" : `&lease=${encodeURIComponent(leaseId)}`;
  return `/hls/seg?session=${encodeURIComponent(sessionId)}${lease}&name=${encodeURIComponent(name)}`;
}

/** Route every segment (and an fMP4 init segment) through the authenticated session. */
export function rewritePlaylist(
  playlist: string,
  sessionId: string,
  leaseId: string | null = null,
): string {
  return playlist.split("\n").map((line) => {
    const map = MAP_URI.exec(line)?.groups?.["uri"];
    if (map !== undefined) {
      return `#EXT-X-MAP:URI="${segmentUrl(basename(map), sessionId, leaseId)}"`;
    }
    if (line === "" || line.startsWith("#")) {
      return line;
    }
    return segmentUrl(basename(line), sessionId, leaseId);
  }).join("\n");
}

export function safeSegmentName(value: string | null): value is string {
  return value !== null && /^(?:segment-\d{6}\.(?:ts|m4s)|init\.mp4)$/u.test(value);
}

export function segmentContentType(name: string): string {
  return name.endsWith(".ts") ? "video/mp2t" : "video/mp4";
}
