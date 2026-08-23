import type { Server } from "bun";
import type { AuthUser } from "./auth.ts";
import {
  aniListAccountResponse,
  aniListAuthConfigResponse,
  aniListCallbackResponse,
  aniListEntryResponse,
  startAniListAuthResponse,
} from "./anilistAccount.ts";

export {
  authenticatedUser,
  authResponse,
  usersResponse,
  type AuthUser,
} from "./auth.ts";
export { syncAniListPlayback } from "./anilistAccount.ts";

const TRUST_PROXY = process.env["NANIME_TRUST_PROXY"] === "true";
const SECURE_COOKIES = process.env["NANIME_SECURE_COOKIES"] !== "false";

function configuredPublicOrigin(value: string | undefined): string | null {
  if (value === undefined || value === "") {
    return null;
  }
  const url = new URL(value);
  if (
    (value !== url.origin && value !== `${url.origin}/`) ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    SECURE_COOKIES && url.protocol !== "https:"
  ) {
    throw new Error("NANIME_PUBLIC_ORIGIN must be an exact origin compatible with cookie security");
  }
  return url.origin;
}

const PUBLIC_ORIGIN = configuredPublicOrigin(process.env["NANIME_PUBLIC_ORIGIN"]);

export async function aniListPublicAuthResponse(
  pathname: string,
  req: Request,
  user: AuthUser | null,
): Promise<Response | null> {
  if (pathname === "/api/auth/anilist/config" && req.method === "GET") {
    return aniListAuthConfigResponse();
  }
  if (pathname === "/api/auth/anilist/start" && req.method === "GET") {
    return startAniListAuthResponse(user);
  }
  return pathname === "/api/auth/anilist/callback" && req.method === "GET"
    ? await aniListCallbackResponse(req)
    : null;
}

export async function aniListUserResponse(
  pathname: string,
  req: Request,
  user: AuthUser,
): Promise<Response | null> {
  if (pathname === "/api/anilist/account") {
    return aniListAccountResponse(req, user);
  }
  return pathname.startsWith("/api/anilist/list/")
    ? await aniListEntryResponse(req, new URL(req.url), user)
    : null;
}

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

export function clientAddress(req: Request, server: Server<undefined> | null): string {
  if (TRUST_PROXY) {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
    if (forwarded !== undefined && forwarded !== "") {
      return forwarded.slice(0, 128);
    }
  }
  return server?.requestIP(req)?.address ?? "unknown";
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
