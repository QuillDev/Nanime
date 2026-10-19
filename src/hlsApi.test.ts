import { describe, expect, test } from "bun:test";
import { hlsUrl, leasedHlsUrl, releaseHlsPlayback } from "./hlsApi.ts";

const LEASE = {
  playerId: "01ff70c9-f72a-42ce-81db-422b1bdc80f3",
  leaseId: "ba38c32f-009e-43ba-960c-b21f40c1779e",
};

describe("HLS playback leases", () => {
  test("preserves stream selection while adding player ownership", () => {
    const source = hlsUrl("Show/Episode 1.mkv", 2, 367.5);
    const leased = new URL(leasedHlsUrl(source, LEASE), "https://nanime.invalid");

    expect(Object.fromEntries(leased.searchParams)).toEqual({
      path: "Show/Episode 1.mkv",
      audio: "2",
      start: "367.5",
      player: LEASE.playerId,
      lease: LEASE.leaseId,
    });
  });

  test("releases one exact attachment with a keepalive request", async () => {
    const sent: { readonly url: URL; readonly method: string | undefined; readonly keepalive: boolean | undefined }[] = [];
    const server = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      sent.push({ url: new URL(String(input), "https://nanime.invalid"), method: init?.method, keepalive: init?.keepalive });
      return Promise.resolve(new Response(null, { status: 200 }));
    };

    await releaseHlsPlayback(LEASE, server);

    expect(sent.map((request) => ({
      params: Object.fromEntries(request.url.searchParams), method: request.method, keepalive: request.keepalive,
    }))).toEqual([{ params: { player: LEASE.playerId, lease: LEASE.leaseId }, method: "POST", keepalive: true }]);
  });
});
