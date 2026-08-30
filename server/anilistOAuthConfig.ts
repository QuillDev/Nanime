import type { OAuthConfig } from "./anilistAccountTypes.ts";

function tokenEncryptionKey(encodedKey: string): Buffer {
  const tokenKey = Buffer.from(encodedKey, "base64");
  if (!/^[A-Za-z\d+/]{43}=$/u.test(encodedKey) || tokenKey.byteLength !== 32) {
    throw new Error("NANIME_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return tokenKey;
}

function oauthRedirect(redirectUri: string, secureCookies: boolean): URL {
  const redirect = URL.parse(redirectUri);
  if (redirect === null) {
    throw new Error("NANIME_ANILIST_REDIRECT_URI must be an absolute URL");
  }
  if (redirect.protocol !== "https:" && secureCookies) {
    throw new Error("AniList OAuth requires an HTTPS redirect when secure cookies are enabled");
  }
  if (redirect.pathname !== "/api/auth/anilist/callback" || redirect.search !== "" || redirect.hash !== "") {
    throw new Error("NANIME_ANILIST_REDIRECT_URI must use the AniList callback path");
  }
  return redirect;
}

export function loadOAuthConfig(secureCookies: boolean): OAuthConfig | null {
  const clientId = process.env["NANIME_ANILIST_CLIENT_ID"] ?? "";
  const clientSecret = process.env["NANIME_ANILIST_CLIENT_SECRET"] ?? "";
  const redirectUri = process.env["NANIME_ANILIST_REDIRECT_URI"] ?? "";
  const encodedKey = process.env["NANIME_TOKEN_ENCRYPTION_KEY"] ?? "";
  if ([clientId, clientSecret, redirectUri, encodedKey].every((value) => value === "")) {
    return null;
  }
  if ([clientId, clientSecret, redirectUri, encodedKey].some((value) => value === "")) {
    throw new Error("All AniList OAuth environment variables must be configured together");
  }
  const redirect = oauthRedirect(redirectUri, secureCookies);
  const publicOrigin = (process.env["NANIME_PUBLIC_ORIGIN"] ?? "").replace(/\/$/u, "");
  if (publicOrigin !== "" && publicOrigin !== redirect.origin) {
    throw new Error("AniList redirect and NANIME_PUBLIC_ORIGIN must use the same origin");
  }
  return {
    clientId,
    clientSecret,
    redirectUri: redirect.href,
    tokenKey: tokenEncryptionKey(encodedKey),
    appOrigin: redirect.origin,
  };
}
