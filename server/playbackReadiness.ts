import { lstat } from "node:fs/promises";
import { HLS_SEGMENT_SECONDS } from "../shared/playback.ts";
import type { HlsStreamSource } from "./hlsTranscode.ts";
import type { MediaLibraryOptions } from "./mediaLibraryOptions.ts";
import { captureProbe } from "./transcodeProgress.ts";
import { sourceTranscodeState, storedCompatibilityCopy, type SourceTranscodeState } from "./transcodes.ts";
import { budget, STORED_KEYFRAME_TAG } from "./transcodeEncoder.ts";
import { sourceKeyframes } from "./hlsPassthrough.ts";

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

/** HEVC or AV1 a client that reports decoding it can play as-is (4:2:0, 8- or 10-bit). */
const PASSTHROUGH_PIXEL_FORMATS = new Set(["yuv420p", "yuv420p10le"]);

function passthroughCodecs(options: PlaybackPlanOptions): ReadonlySet<string> {
  return new Set([
    ...(options.hevcClient === true ? ["hevc"] : []),
    ...(options.av1Client === true ? ["av1"] : []),
  ]);
}

function passthroughPlayable(probe: VideoProbe, codecs: ReadonlySet<string>): boolean {
  return codecs.has(probe.codec) && PASSTHROUGH_PIXEL_FORMATS.has(probe.pixelFormat);
}

function segmentAligned(probe: VideoProbe): boolean {
  return browserSafe(probe) && probe.keyframeSeconds === HLS_SEGMENT_SECONDS;
}

export type PlaybackPlan =
  | { readonly kind: "stream"; readonly source: HlsStreamSource }
  | { readonly kind: "transcode-required"; readonly transcode: SourceTranscodeState | null };

export interface PlaybackPlanOptions extends MediaLibraryOptions {
  readonly hardwareAcceleration: string;
  /** The client decodes HEVC, so HEVC sources stream untouched instead of needing a transcode. */
  readonly hevcClient?: boolean;
  /** The client decodes AV1, so AV1 sources stream untouched the same way. */
  readonly av1Client?: boolean;
}

/**
 * Live HLS repackages HEVC or AV1 for clients that decode it, remuxes segment-aligned
 * stored transcodes, or re-encodes video that is already browser-safe (or uses
 * hardware encoding). Anything else must be transcoded ahead of time: a
 * software re-encode cannot keep up live.
 */
export async function playbackPlan(abs: string, rel: string, options: PlaybackPlanOptions): Promise<PlaybackPlan> {
  const codecs = passthroughCodecs(options);
  if (codecs.size > 0) {
    const source = await cachedProbe(abs);
    if (source !== null && passthroughPlayable(source, codecs)) {
      return { kind: "stream", source: { input: abs, videoMode: "passthrough" } };
    }
  }
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

const MAX_READINESS_PATHS = 500;

interface ReadinessRequest {
  readonly paths: readonly string[];
  readonly hevc: boolean;
  readonly av1: boolean;
}

async function readinessRequest(req: Request): Promise<ReadinessRequest | null> {
  const body = (await req.json().catch(() => null)) as { readonly paths?: unknown; readonly hevc?: unknown; readonly av1?: unknown } | null;
  const paths = body?.paths;
  const valid = Array.isArray(paths) && paths.length <= MAX_READINESS_PATHS && paths.every((path) => typeof path === "string");
  return valid ? { paths: paths as string[], hevc: body?.hevc === true, av1: body?.av1 === true } : null;
}

/**
 * Probe keyframes for the episode a player is opening (a single-path readiness
 * request), so its playlist needn't wait. Never for a whole season: probing
 * reads every file in full, and a dozen cold reads at once stalled playback
 * start by ~20 s.
 */
async function warmKeyframes(abs: string): Promise<void> {
  try {
    await sourceKeyframes(abs);
  } catch {
    // The playlist request probes again and reports any failure.
  }
}

/** Readiness for several library videos at once (a whole season); unknown paths are omitted. */
export async function playbackReadinessResponse(
  req: Request,
  resolve: (rel: string) => Promise<string | null>,
  options: PlaybackPlanOptions,
): Promise<Response> {
  const request = await readinessRequest(req);
  if (request === null) {
    return new Response("Choose up to 500 videos", { status: 400 });
  }
  const items = await Promise.all(request.paths.map(async (rel) => {
    const abs = await resolve(rel);
    if (abs === null) {
      return [];
    }
    const plan = await playbackPlan(abs, rel, { ...options, hevcClient: request.hevc, av1Client: request.av1 });
    if (request.paths.length === 1 && plan.kind === "stream" && plan.source.videoMode === "passthrough") {
      void warmKeyframes(abs);
    }
    return [plan.kind === "stream"
      ? { path: rel, ready: true, transcode: sourceTranscodeState(rel) }
      : { path: rel, ready: false, transcode: plan.transcode }];
  }));
  return Response.json({ workers: budget.workers, items: items.flat() });
}
