import type { Server } from "bun";

export {
  authenticatedUser,
  authResponse,
  usersResponse,
  type AuthUser,
} from "./auth.ts";

const PUBLIC_ORIGIN = process.env["NANIME_PUBLIC_ORIGIN"]?.replace(/\/+$/u, "") ?? null;
const TRUST_PROXY = process.env["NANIME_TRUST_PROXY"] === "true";
const SECURE_COOKIES = process.env["NANIME_SECURE_COOKIES"] !== "false";

export function requestOriginAllowed(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return true;
  }
  const origin = req.headers.get("origin");
  if (origin === null) {
    return false;
  }
  const expected = PUBLIC_ORIGIN ?? new URL(req.url).origin;
  return origin === expected;
}

export function clientAddress(req: Request, server: Server<undefined>): string {
  if (TRUST_PROXY) {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
    if (forwarded !== undefined && forwarded !== "") {
      return forwarded.slice(0, 128);
    }
  }
  return server.requestIP(req)?.address ?? "unknown";
}

export function securityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: https:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
  ].join("; "));
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  if (SECURE_COOKIES) {
    headers.set("strict-transport-security", "max-age=31536000");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
