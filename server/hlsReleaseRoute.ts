import { releaseHlsPlayback } from "./hls.ts";

export async function hlsReleaseRouteResponse(url: URL, userId: number): Promise<Response> {
  const playerId = url.searchParams.get("player") ?? "";
  const leaseId = url.searchParams.get("lease") ?? "";
  const released = await releaseHlsPlayback(userId, playerId, leaseId);
  return Response.json({ released });
}
