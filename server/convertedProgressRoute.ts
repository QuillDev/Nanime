import { join } from "node:path";
import { selectedAudioTrack } from "./audioTracks.ts";
import { convertedProgress } from "./hlsSegmentCache.ts";
import { SEGMENT_CACHE_FOLDER } from "./playbackReadiness.ts";

interface ConvertedProgressRequest {
  readonly abs: string;
  readonly audioIndex: number | null;
  readonly duration: number;
  readonly mediaRoot: string;
  readonly preferredAudioLanguage: string | null;
}

/** `/hls/converted`: which parts of an episode are converted and kept, and which are converting now. */
export async function convertedProgressResponse(request: ConvertedProgressRequest): Promise<Response> {
  const audioTrack = await selectedAudioTrack(request.abs, request.audioIndex, request.preferredAudioLanguage);
  if (audioTrack === null || !Number.isFinite(request.duration) || request.duration <= 0) {
    return new Response("Bad request", { status: 400 });
  }
  const progress = await convertedProgress({
    input: request.abs, audioTrack, cacheRoot: join(request.mediaRoot, SEGMENT_CACHE_FOLDER), duration: request.duration,
  });
  return Response.json(progress, { headers: { "cache-control": "no-store" } });
}
