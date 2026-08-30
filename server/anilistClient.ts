import { createHash } from "node:crypto";

const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_LIMIT = 25;
const REQUEST_WINDOW_MS = 60_000;
const SECOND_MS = REQUEST_WINDOW_MS / 60;
const DEFAULT_OUTAGE_COOLDOWN_MS = 30_000;
const DISABLED_API_COOLDOWN_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 200;

interface GraphQlResponse<T> {
  readonly data?: T;
  readonly errors?: readonly { readonly message?: unknown }[];
}

export type GraphQlVariables = Readonly<Record<string, number | string>>;

interface AniListRequestOptions {
  readonly query: string;
  readonly variables: GraphQlVariables;
  readonly token?: string;
  readonly mutation?: boolean;
  readonly cacheKey?: string;
  readonly cacheMs?: number;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly value: unknown;
}

export class AniListUpstreamError extends Error {
  public readonly retryAfterSeconds: number | null;
  public readonly responseStatus: 502 | 503;

  public constructor(
    message: string,
    responseStatus: 502 | 503,
    retryAfterDurationMs: number | null = null,
  ) {
    super(message);
    this.name = "AniListUpstreamError";
    this.responseStatus = responseStatus;
    this.retryAfterSeconds = retryAfterDurationMs === null
      ? null
      : Math.max(1, Math.ceil(retryAfterDurationMs / 1000));
  }
}

const requestTimes: number[] = [];
const inFlight = new Map<string, Promise<unknown>>();
const cache = new Map<string, CacheEntry>();
let blockedUntil = 0;

function requestKey(options: AniListRequestOptions): string {
  return createHash("sha256")
    .update(options.token ?? "public")
    .update("\0")
    .update(options.query)
    .update("\0")
    .update(JSON.stringify(options.variables))
    .digest("hex");
}

function retryAfterMs(headers: Headers, now: number): number | null {
  const value = headers.get("retry-after");
  if (value === null) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function rateLimitResetMs(headers: Headers, now: number): number | null {
  const remaining = Number(headers.get("x-ratelimit-remaining"));
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (!Number.isFinite(remaining) || remaining > 0 || !Number.isFinite(reset)) {
    return null;
  }
  return Math.max(0, reset * SECOND_MS - now);
}

function openCircuit(durationMs: number): void {
  blockedUntil = Math.max(blockedUntil, Date.now() + Math.max(SECOND_MS, durationMs));
}

function assertRequestAllowed(): void {
  const now = Date.now();
  if (blockedUntil > now) {
    throw new AniListUpstreamError(
      "AniList is temporarily unavailable",
      503,
      blockedUntil - now,
    );
  }
  while (requestTimes[0] !== undefined && requestTimes[0] <= now - REQUEST_WINDOW_MS) {
    requestTimes.shift();
  }
  if (requestTimes.length >= REQUEST_LIMIT) {
    const retryIn = REQUEST_WINDOW_MS - (now - (requestTimes[0] ?? now));
    openCircuit(retryIn);
    throw new AniListUpstreamError("AniList request limit reached", 503, retryIn);
  }
  requestTimes.push(now);
}

function firstErrorMessage(payload: GraphQlResponse<unknown>): string | null {
  const message = payload.errors?.[0]?.message;
  return typeof message === "string" && message !== "" ? message : null;
}

async function fetchAniListResponse(options: AniListRequestOptions): Promise<Response> {
  try {
    return await fetch(ANILIST_GRAPHQL_URL, {
      method: "POST",
      headers: requestHeaders(options.token),
      body: JSON.stringify({ query: options.query, variables: options.variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    openCircuit(DEFAULT_OUTAGE_COOLDOWN_MS);
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "AniList request timed out"
      : "Could not reach AniList";
    throw new AniListUpstreamError(message, 503, DEFAULT_OUTAGE_COOLDOWN_MS);
  }
}

async function assertSuccessfulResponse(response: Response, now: number): Promise<void> {
  const headerCooldown = rateLimitResetMs(response.headers, now);
  if (headerCooldown !== null && headerCooldown > 0) {
    openCircuit(headerCooldown);
  }
  if (!response.ok) {
    const errorPayload = await response.json().catch((): null => null) as GraphQlResponse<unknown> | null;
    const message = errorPayload === null
      ? `AniList returned an invalid response (HTTP ${String(response.status)})`
      : firstErrorMessage(errorPayload) ?? `AniList returned HTTP ${String(response.status)}`;
    if (response.status === 403 || response.status === 429 || response.status >= 500) {
      const cooldown = retryAfterMs(response.headers, now) ?? (
        response.status === 403 ? DISABLED_API_COOLDOWN_MS : DEFAULT_OUTAGE_COOLDOWN_MS
      );
      openCircuit(cooldown);
      throw new AniListUpstreamError(message, 503, cooldown);
    }
    throw new AniListUpstreamError(message, 502);
  }
}

async function responseData<T>(response: Response): Promise<T> {
  const payload = await response.json().catch((): null => null) as GraphQlResponse<T> | null;
  if (payload?.data === undefined) {
    throw new AniListUpstreamError(
      payload === null
        ? "AniList returned an invalid response"
        : firstErrorMessage(payload) ?? "AniList response did not include data",
      502,
    );
  }
  return payload.data;
}

async function request<T>(options: AniListRequestOptions): Promise<T> {
  assertRequestAllowed();
  const response = await fetchAniListResponse(options);
  const now = Date.now();
  await assertSuccessfulResponse(response, now);
  return responseData<T>(response);
}

function requestHeaders(token: string | undefined): Headers {
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
  });
  if (token !== undefined) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return headers;
}

function cached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (entry === undefined) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function storeCached(key: string, value: unknown, cacheMs: number): void {
  for (const [existingKey, entry] of cache) {
    if (entry.expiresAt <= Date.now()) {
      cache.delete(existingKey);
    }
  }
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + cacheMs });
}

export async function aniListGraphQl<T>(options: AniListRequestOptions): Promise<T> {
  const cachedValue = options.cacheKey === undefined ? undefined : cached<T>(options.cacheKey);
  if (cachedValue !== undefined) {
    return cachedValue;
  }
  const key = requestKey(options);
  if (!options.mutation) {
    const pending = inFlight.get(key);
    if (pending !== undefined) {
      return pending as Promise<T>;
    }
  }
  const pending = request<T>(options);
  if (!options.mutation) {
    inFlight.set(key, pending);
  }
  try {
    const value = await pending;
    if (options.cacheKey !== undefined && options.cacheMs !== undefined && options.cacheMs > 0) {
      storeCached(options.cacheKey, value, options.cacheMs);
    }
    return value;
  } finally {
    if (!options.mutation && inFlight.get(key) === pending) {
      inFlight.delete(key);
    }
  }
}

export function aniListErrorResponse(error: unknown): Response | null {
  if (!(error instanceof AniListUpstreamError)) {
    return null;
  }
  const headers = new Headers({ "cache-control": "no-store" });
  if (error.retryAfterSeconds !== null) {
    headers.set("retry-after", String(error.retryAfterSeconds));
  }
  return Response.json({
    source: "anilist",
    message: error.message,
    retryAfterSeconds: error.retryAfterSeconds,
  }, { status: error.responseStatus, headers });
}
