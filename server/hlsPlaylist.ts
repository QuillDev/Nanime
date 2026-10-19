import { basename, join } from "node:path";
import { captureProbe } from "./transcodeProgress.ts";

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

function firstSegment(playlist: string): string | undefined {
  return playlist.split("\n").find((line) => line !== "" && !line.startsWith("#"));
}

/**
 * The media time a passthrough session's playlist begins at: the source
 * keyframe ffmpeg snapped back to. Players place the first segment at local
 * time zero, so the client needs this to map local time to episode time.
 */
export async function passthroughSessionStart(directory: string, playlist: string): Promise<number | null> {
  const segment = firstSegment(playlist);
  if (segment === undefined) {
    return null;
  }
  const input = `concat:${join(directory, "init.mp4")}|${join(directory, basename(segment))}`;
  const proc = Bun.spawn([
    "ffprobe", "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=start_time", "-of", "csv=p=0", input,
  ], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const { code, text } = await captureProbe(proc, new Response(proc.stdout).text());
  const start = Number(text.trim());
  return code === 0 && text.trim() !== "" && Number.isFinite(start) ? start : null;
}
