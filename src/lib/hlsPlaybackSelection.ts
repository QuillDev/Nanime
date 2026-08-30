export type HlsPlaybackEngine = "hls.js" | "native" | "unsupported";

export function selectHlsPlaybackEngine(
  hlsJsSupported: boolean,
  nativeHlsSupported: boolean,
): HlsPlaybackEngine {
  if (hlsJsSupported) {
    return "hls.js";
  }
  return nativeHlsSupported ? "native" : "unsupported";
}
