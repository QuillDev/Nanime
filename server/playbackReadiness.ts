import { lstat } from "node:fs/promises";
import { HLS_SEGMENT_SECONDS } from "../shared/playback.ts";
import type { HlsStreamSource } from "./hlsTranscode.ts";
import type { MediaLibraryOptions } from "./mediaLibraryOptions.ts";
import { captureProbe } from "./transcodeProgress.ts";
import { sourceTranscodeState, storedCompatibilityCopy, type SourceTranscodeState } from "./transcodes.ts";
import { STORED_KEYFRAME_TAG } from "./transcodeEncoder.ts";

export { resumeTranscodeQueue } from "./transcodes.ts";

/** Pixel formats browsers decode in H.264 without a re-encode. */
const BROWSER_SAFE_PIXEL_FORMATS = new Set(["yuv420p", "yuvj420p"]);

interface VideoProbe {
  readonly codec: string;
  readonly pixelFormat: string;
  readonly keyframeSeconds: number | null;
}

const probeCache = new Map<string, { readonly signature: string; readonly probe: Promise<VideoProbe | null> }>();

async function probeVideo(abs: string): Promise<VideoProbe | null> {
  const proc = Bun.spawn([
    "ffprobe", "-v", "error", "-select_streams", "v:0",
    "-show_entries", `stream=codec_name,pix_fmt:format_tags=${STORED_KEYFRAME_TAG}`,
    "-of", "json", abs,
  ], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const { code, text } = await captureProbe(proc, new Response(proc.stdout).text());
  if (code !== 0) {
    return null;
  }
  const parsed = JSON.parse(text) as {
    readonly streams?: readonly { readonly codec_name?: string; readonly pix_fmt?: string }[];
    readonly format?: { readonly tags?: Readonly<Record<string, string>> };
  };
  const stream = parsed.streams?.[0];
  if (stream === undefined) {
    return null;
  }
  const tags = parsed.format?.tags ?? {};
  const tagged = Object.entries(tags).find(([name]) => name.toUpperCase() === STORED_KEYFRAME_TAG)?.[1];
  const keyframeSeconds = tagged === undefined ? Number.NaN : Number(tagged);
  return {
    codec: stream.codec_name ?? "",
    pixelFormat: stream.pix_fmt ?? "",
    keyframeSeconds: Number.isFinite(keyframeSeconds) ? keyframeSeconds : null,
  };
}

/** Probe once per file version; playlist polling must not spawn ffprobe each time. */
async function cachedProbe(abs: string): Promise<VideoProbe | null> {
  const stat = await lstat(abs).catch(() => null);
  if (stat === null) {
    return null;
  }
  const signature = `${String(stat.size)}:${String(stat.mtimeMs)}`;
  const cached = probeCache.get(abs);
  if (cached?.signature === signature) {
    return cached.probe;
  }
  const probe = settledProbe(abs);
  probeCache.set(abs, { signature, probe });
  return probe;
}

async function settledProbe(abs: string): Promise<VideoProbe | null> {
  try {
    return await probeVideo(abs);
  } catch {
    return null;
  }
}

function browserSafe(probe: VideoProbe): boolean {
  return probe.codec === "h264" && BROWSER_SAFE_PIXEL_FORMATS.has(probe.pixelFormat);
}

function segmentAligned(probe: VideoProbe): boolean {
  return browserSafe(probe) && probe.keyframeSeconds === HLS_SEGMENT_SECONDS;
}

export type PlaybackPlan =
  | { readonly kind: "stream"; readonly source: HlsStreamSource }
  | { readonly kind: "transcode-required"; readonly transcode: SourceTranscodeState | null };

/**
 * Live HLS only remuxes segment-aligned stored transcodes or re-encodes video
 * that is already browser-safe (or uses hardware encoding). Anything else must
 * be transcoded ahead of time: a software re-encode cannot keep up live.
 */
export async function playbackPlan(
  abs: string,
  rel: string,
  options: MediaLibraryOptions & { readonly hardwareAcceleration: string },
): Promise<PlaybackPlan> {
  const stored = await storedCompatibilityCopy(rel, options);
  const storedProbe = stored === null ? null : await cachedProbe(stored);
  if (stored !== null && storedProbe !== null && segmentAligned(storedProbe)) {
    return { kind: "stream", source: { input: stored, videoMode: "copy" } };
  }
  const probe = await cachedProbe(abs);
  if (probe !== null && segmentAligned(probe)) {
    return { kind: "stream", source: { input: abs, videoMode: "copy" } };
  }
  if (options.hardwareAcceleration === "vaapi" || (probe !== null && browserSafe(probe))) {
    return { kind: "stream", source: { input: abs, videoMode: "encode" } };
  }
  return { kind: "transcode-required", transcode: sourceTranscodeState(rel) };
}

export async function playbackReadinessResponse(
  abs: string,
  rel: string,
  options: MediaLibraryOptions & { readonly hardwareAcceleration: string },
): Promise<Response> {
  const plan = await playbackPlan(abs, rel, options);
  return Response.json(plan.kind === "stream"
    ? { ready: true, transcode: null }
    : { ready: false, transcode: plan.transcode });
}
