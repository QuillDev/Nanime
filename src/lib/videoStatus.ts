import type { MediaScan, TranscodeJob } from "../types.ts";

/** What the last media scan says about one file, plus whether it still needs a stored transcode. */
export interface VideoStatus {
  readonly codec: string | null;
  readonly resolution: string | null;
  readonly needsTranscode: boolean;
}

const BROWSER_SAFE_CODECS = new Set(["h264", "avc", "avc1"]);
const CODEC_NAMES = new Map(Object.entries({ h264: "H.264", hevc: "HEVC", av1: "AV1", vp9: "VP9", mpeg4: "MPEG-4" }));

function resolution(scan: MediaScan): string | null {
  return scan.height === null ? null : `${String(scan.height)}p`;
}

/** Files with a finished or running stored transcode don't need another. */
function transcodedPaths(jobs: readonly TranscodeJob[]): ReadonlySet<string> {
  return new Set(jobs.filter((job) => job.status !== "failed" && job.status !== "cancelled").map((job) => job.sourcePath));
}

export function buildVideoStatuses(
  scans: readonly MediaScan[],
  jobs: readonly TranscodeJob[],
): ReadonlyMap<string, VideoStatus> {
  const transcoded = transcodedPaths(jobs);
  const statuses = new Map<string, VideoStatus>();
  for (const scan of scans) {
    const codec = scan.videoCodec?.toLocaleLowerCase() ?? null;
    statuses.set(scan.sourcePath, {
      codec: codec === null ? null : CODEC_NAMES.get(codec) ?? codec.toLocaleUpperCase(),
      resolution: resolution(scan),
      needsTranscode: codec !== null && !BROWSER_SAFE_CODECS.has(codec) && !transcoded.has(scan.sourcePath),
    });
  }
  return statuses;
}

export function needsTranscodeCount(rels: readonly string[], statuses: ReadonlyMap<string, VideoStatus>): number {
  return rels.filter((rel) => statuses.get(rel)?.needsTranscode === true).length;
}
