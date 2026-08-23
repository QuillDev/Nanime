import { expect, test } from "bun:test";
import {
  aniListErrorResponse,
  aniListGraphQl,
  AniListUpstreamError,
} from "./anilistClient.ts";
import { apiError } from "../src/apiError.ts";

test("deduplicates, caches, and opens a circuit for an AniList outage", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = Object.assign(
    (): Promise<Response> => {
      calls += 1;
      return Promise.resolve(calls === 1
        ? Response.json({ data: { value: 1 } })
        : Response.json({
          data: null,
          errors: [{ message: "The AniList API is temporarily unavailable" }],
        }, { status: 403 }));
    },
    { preconnect: originalFetch.preconnect },
  );

  try {
    const cachedQuery = {
      query: "query { Test }",
      variables: {},
      cacheKey: "test:cached",
      cacheMs: 60_000,
    };
    const [first, second] = await Promise.all([
      aniListGraphQl<{ readonly value: number }>(cachedQuery),
      aniListGraphQl<{ readonly value: number }>(cachedQuery),
    ]);
    expect(first.value).toBe(1);
    expect(second.value).toBe(1);
    const cached = await aniListGraphQl<{ readonly value: number }>(cachedQuery);
    expect(cached.value).toBe(1);
    expect(calls).toBe(1);

    let outage: unknown = null;
    try {
      await aniListGraphQl({ query: "query { Outage }", variables: {} });
    } catch (error) {
      outage = error;
    }
    expect(outage).toBeInstanceOf(AniListUpstreamError);
    const response = aniListErrorResponse(outage);
    expect(response?.status).toBe(503);
    const payload: unknown = await response?.json();
    expect(payload).toEqual({
      source: "anilist",
      message: "The AniList API is temporarily unavailable",
      retryAfterSeconds: 300,
    });
    const clientError = apiError({
      status: response?.status,
      value: payload,
    }, "AniList request");
    expect(clientError.source).toBe("anilist");
    expect(clientError.status).toBe(503);
    expect(clientError.retryAfterSeconds).toBe(300);
    expect(clientError.message).toContain("Retry after 300 seconds");

    await expect(aniListGraphQl({
      query: "query { BlockedByCircuit }",
      variables: {},
    })).rejects.toBeInstanceOf(AniListUpstreamError);
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
