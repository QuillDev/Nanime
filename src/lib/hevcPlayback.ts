/**
 * HEVC Main 10 at level 5 (1080p), the profile HEVC anime releases use; any
 * decoder that accepts it also plays 8-bit Main. Clients that decode it can
 * stream HEVC sources untouched instead of waiting for a stored transcode.
 */
const HEVC_MAIN10 = "video/mp4; codecs=\"hvc1.2.4.L150.B0\"";
/** AV1 Main, level 4.0 (1080p), 10-bit: the profile AV1 anime releases use. */
const AV1_MAIN10 = "video/mp4; codecs=\"av01.0.08M.10\"";

interface MediaSourceSupport {
  readonly isTypeSupported: (type: string) => boolean;
}

function mediaSourceSupport(): MediaSourceSupport | undefined {
  const scope = globalThis as { MediaSource?: MediaSourceSupport; ManagedMediaSource?: MediaSourceSupport };
  return scope.MediaSource ?? scope.ManagedMediaSource;
}

/** Mirrors the player's engine choice: hls.js (MSE) when available, otherwise native HLS. */
function playbackSupported(type: string): boolean {
  const mediaSource = mediaSourceSupport();
  if (mediaSource !== undefined) {
    return mediaSource.isTypeSupported(type);
  }
  if (typeof document === "undefined") {
    return false;
  }
  return document.createElement("video").canPlayType(type) !== "";
}

/**
 * Codecs this device said it decodes but then failed on. Some decoders (budget
 * Android TVs) accept HEVC Main 10 in `isTypeSupported` and then fail on the
 * first frame; those devices get the converted stream for a while instead.
 */
const UNPLAYABLE_KEY = "nanime.unplayable-codecs";
const REMEMBER_FAILURE_MS = 30 * 24 * 60 * 60 * 1000;

interface UnplayableCodecs {
  readonly hevc?: unknown;
  readonly av1?: unknown;
}

function unplayableCodecs(): UnplayableCodecs {
  try {
    return JSON.parse(localStorage.getItem(UNPLAYABLE_KEY) ?? "{}") as UnplayableCodecs;
  } catch {
    return {};
  }
}

function recentlyFailed(failedAt: unknown): boolean {
  return typeof failedAt === "number" && Date.now() - failedAt < REMEMBER_FAILURE_MS;
}

/** Stops asking for `codec` untouched on this device: its decoder failed on it. */
export function markCodecUnplayable(codec: string): void {
  if (codec !== "hevc" && codec !== "av1") {
    return;
  }
  try {
    localStorage.setItem(UNPLAYABLE_KEY, JSON.stringify({ ...unplayableCodecs(), [codec]: Date.now() }));
  } catch {
    // Storage may be off; this player still falls back below.
  }
}

export function hevcPlaybackSupported(): boolean {
  return !recentlyFailed(unplayableCodecs().hevc) && playbackSupported(HEVC_MAIN10);
}

export function av1PlaybackSupported(): boolean {
  return !recentlyFailed(unplayableCodecs().av1) && playbackSupported(AV1_MAIN10);
}
