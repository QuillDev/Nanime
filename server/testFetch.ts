/** Test-only support: stand in for an upstream HTTP API by replacing global fetch. */

export type FakeUpstream = (url: URL) => Response | Promise<Response>;

/** Runs `body` with every fetch answered by `upstream`, then restores the real fetch. */
export async function withFakeUpstream<T>(upstream: FakeUpstream, body: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    (input: string | URL | Request): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      return Promise.resolve(upstream(url));
    },
    { preconnect: realFetch.preconnect },
  );
  try {
    return await body();
  } finally {
    globalThis.fetch = realFetch;
  }
}
