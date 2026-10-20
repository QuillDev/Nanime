import { expect, test } from "bun:test";
import { aniListErrorResponse, aniListGraphQl, AniListUpstreamError } from "./anilistClient.ts";
import { withFakeUpstream } from "./testFetch.ts";

const OUTAGE = { data: null, errors: [{ message: "The AniList API is temporarily unavailable" }] };

test("shares and caches answers, then stops calling AniList during an outage", async () => {
  // The upstream request count is the contract here: AniList rate-limits and bans noisy clients.
  let requests = 0;
  await withFakeUpstream(() => {
    requests += 1;
    return requests === 1 ? Response.json({ data: { value: 1 } }) : Response.json(OUTAGE, { status: 403 });
  }, async () => {
    const cachedQuery = { query: "query { Test }", variables: {}, cacheKey: "test:cached", cacheMs: 60_000 };
    const answers = await Promise.all([
      aniListGraphQl<{ readonly value: number }>(cachedQuery),
      aniListGraphQl<{ readonly value: number }>(cachedQuery),
      aniListGraphQl<{ readonly value: number }>(cachedQuery),
    ]);
    const cached = await aniListGraphQl<{ readonly value: number }>(cachedQuery);
    expect([...answers, cached].map((answer) => answer.value)).toEqual([1, 1, 1, 1]);
    expect(requests).toBe(1);

    const outage = await aniListGraphQl({ query: "query { Outage }", variables: {} }).catch((error: unknown) => error);
    expect(outage).toBeInstanceOf(AniListUpstreamError);
    const response = aniListErrorResponse(outage);
    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({
      source: "anilist",
      message: "The AniList API is temporarily unavailable",
      retryAfterSeconds: 300,
    });

    await expect(aniListGraphQl({ query: "query { BlockedByCircuit }", variables: {} }))
      .rejects.toBeInstanceOf(AniListUpstreamError);
    expect(requests).toBe(2);
  });
});
