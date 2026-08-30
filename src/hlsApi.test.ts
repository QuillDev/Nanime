import { describe, expect, mock, test } from "bun:test";
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
    const request = mock((_input: RequestInfo | URL, _init?: RequestInit) => (
      Promise.resolve(new Response(null, { status: 200 }))
    ));

    await releaseHlsPlayback(LEASE, request);

    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0] ?? [];
    const parsed = new URL(String(url), "https://nanime.invalid");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      player: LEASE.playerId,
      lease: LEASE.leaseId,
    });
    expect(init).toMatchObject({ method: "POST", keepalive: true });
  });
});
