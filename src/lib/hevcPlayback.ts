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

export function hevcPlaybackSupported(): boolean {
  return playbackSupported(HEVC_MAIN10);
}

export function av1PlaybackSupported(): boolean {
  return playbackSupported(AV1_MAIN10);
}
