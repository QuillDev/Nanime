const MEDIA_GET_PATHS = new Set([
  "/stream",
  "/thumbnail",
  "/trickplay/sheet",
  "/trickplay/frame",
  "/subtitle",
  "/hls/index",
  "/hls/converted",
  "/hls/seg",
]);

export function mediaRequest(pathname: string, method: string): boolean {
  if (pathname === "/api/hls/release") {
    return method === "POST";
  }
  if (pathname === "/api/subtitles") {
    return true;
  }
  return pathname === "/api/audio-tracks"
    ? method === "GET"
    : (method === "GET" || method === "HEAD") && MEDIA_GET_PATHS.has(pathname);
}
