import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { CookieJar } from "./sourceCookies.ts";

/**
 * HTTP for source plugins, answering in the JSON shape Mangayomi's bridge
 * gives extensions. Plugins are third-party code, so they may only reach the
 * public internet: hosts that resolve to loopback, private or link-local
 * addresses are refused (tests opt out with NANIME_SOURCE_ALLOW_PRIVATE_NETWORK).
 */
const ALLOW_PRIVATE = process.env["NANIME_SOURCE_ALLOW_PRIVATE_NETWORK"] === "1";
const TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
// Mangayomi sends a browser identity on Linux; many sites refuse requests without one.
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export class SourceRequestError extends Error {
  override name = "SourceRequestError";
}

// Non-public IPv4 ranges as [first octet, lowest second octet, highest second octet].
const PRIVATE_IPV4: readonly (readonly [number, number, number])[] = [
  [0, 0, 255], [10, 0, 255], [127, 0, 255], [100, 64, 127], [169, 254, 254], [172, 16, 31], [192, 168, 168],
];

function privateIpv4(address: string): boolean {
  const [a = 0, b = 0] = address.split(".").map(Number);
  return a >= 224 || PRIVATE_IPV4.some(([first, low, high]) => a === first && b >= low && b <= high);
}

function privateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    return privateIpv4(address);
  }
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(?<v4>\d+\.\d+\.\d+\.\d+)$/u.exec(lower)?.groups?.["v4"];
  if (mapped !== undefined) {
    return privateIpv4(mapped);
  }
  return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") ||
    lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb") || lower.startsWith("ff");
}

/** Throws unless `url` is http(s) on a host that resolves only to public addresses. */
export async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SourceRequestError(`Sources can only use http and https links, not ${url.protocol}`);
  }
  if (ALLOW_PRIVATE) {
    return;
  }
  const host = url.hostname.replaceAll(/^\[|\]$/gu, "");
  const addresses = isIP(host) === 0 ? await lookup(host, { all: true }).catch(() => []) : [{ address: host }];
  if (addresses.length === 0 || addresses.some(({ address }) => privateAddress(address))) {
    throw new SourceRequestError(`Sources can't reach ${url.hostname}`);
  }
}

interface SourceRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly followRedirects: boolean;
}

function requestBody(request: SourceRequest, headers: Headers): string | URLSearchParams | null {
  const { body } = request;
  if (body === null || body === undefined || request.method === "GET" || request.method === "HEAD") {
    return null;
  }
  if (typeof body === "string") {
    return body;
  }
  if (headers.get("content-type")?.includes("application/json") === true) {
    return JSON.stringify(body);
  }
  // Like Dart's http package: a map body is sent as a form.
  const fields = Object.entries(body as object).map(([key, value]): [string, string] => [key, String(value)]);
  return new URLSearchParams(fields);
}

async function boundedText(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) {
    throw new SourceRequestError("A source response was too large");
  }
  const bytes = await response.bytes();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new SourceRequestError("A source response was too large");
  }
  return new TextDecoder().decode(bytes);
}

const MAX_REDIRECTS = 10;

/** Sends one hop, checking the host first; redirects are followed here so every hop gets checked. */
async function send(request: SourceRequest, url: URL, jar: CookieJar): Promise<Response> {
  await assertPublicUrl(url);
  const headers = new Headers(request.headers);
  if (!headers.has("user-agent")) {
    headers.set("user-agent", USER_AGENT);
  }
  const cookie = jar.header(url);
  if (cookie !== null && !headers.has("cookie")) {
    headers.set("cookie", cookie);
  }
  const response = await fetch(url, {
    method: request.method, headers, body: requestBody(request, headers), redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  jar.store(url, response);
  return response;
}

interface Hop {
  readonly request: SourceRequest;
  readonly url: URL;
  readonly hops: number;
}

async function follow({ request, url, hops }: Hop, jar: CookieJar): Promise<{ readonly response: Response; readonly url: URL }> {
  const response = await send(request, url, jar);
  const location = response.headers.get("location");
  if (!request.followRedirects || response.status < 300 || response.status >= 400 || location === null) {
    return { response, url };
  }
  if (hops >= MAX_REDIRECTS) {
    throw new SourceRequestError("A source link redirected too many times");
  }
  await response.body?.cancel();
  // Like browsers: a 303 (or a POST answered with 301/302) continues as a GET without a body.
  const asGet = response.status === 303 || (request.method === "POST" && response.status <= 302);
  const next = asGet ? { ...request, method: "GET", body: null } : request;
  return await follow({ request: next, url: new URL(location, url), hops: hops + 1 }, jar);
}

/** One plugin request, answered as Mangayomi's `Response.toJson()`. */
export async function sourceFetch(request: SourceRequest, jar: CookieJar): Promise<string> {
  const target = URL.parse(request.url);
  if (target === null) {
    throw new SourceRequestError(`A source asked for an invalid link: ${request.url.slice(0, 200)}`);
  }
  const { response, url } = await follow({ request, url: target, hops: 0 }, jar);
  const body = request.method === "HEAD" ? "" : await boundedText(response);
  return JSON.stringify({
    body,
    headers: Object.fromEntries(response.headers),
    isRedirect: response.status >= 300 && response.status < 400,
    persistentConnection: true,
    reasonPhrase: response.statusText,
    statusCode: response.status,
    request: { method: request.method, url: url.href, headers: request.headers, followRedirects: request.followRedirects },
  });
}
