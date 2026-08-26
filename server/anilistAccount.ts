import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { database } from "./database.ts";
import { createSessionRedirect, type AuthUser } from "./auth.ts";
import { aniListGraphQl, type GraphQlVariables } from "./anilistClient.ts";
import { jsonObject } from "./json.ts";
import type {
  AniListAccountRow,
  AniListListEntry,
  AniListPlaybackTarget,
  DeleteMediaListData,
  ListUpdate,
  MediaListData,
  OAuthConfig,
  OAuthStateRow,
  SaveMediaListData,
  SyncRow,
  TokenResponse,
  ViewerData,
} from "./anilistAccountTypes.ts";

export type { AniListListEntry, AniListPlaybackTarget } from "./anilistAccountTypes.ts";

const ANILIST_AUTHORIZE_URL = "https://anilist.co/api/v2/oauth/authorize";
const ANILIST_TOKEN_URL = "https://anilist.co/api/v2/oauth/token";
const OAUTH_STATE_LIFETIME_MS = 10 * 60 * 1000;
const MAX_OAUTH_STATES = 10_000;
const ANILIST_REQUEST_TIMEOUT_MS = 15_000;
const SECURE_COOKIES = process.env["NANIME_SECURE_COOKIES"] !== "false";
const STATE_COOKIE = "nanime_anilist_oauth";

const insertOAuthState = database.query<void, [string, number | null, number, number]>(`
  INSERT INTO anilist_oauth_states (state_hash, user_id, expires_at, created_at)
  VALUES (?, ?, ?, ?)
`);
const findOAuthState = database.query<OAuthStateRow, [string]>(`
  SELECT user_id, expires_at FROM anilist_oauth_states WHERE state_hash = ?
`);
const deleteOAuthState = database.query<void, [string]>(
  "DELETE FROM anilist_oauth_states WHERE state_hash = ?",
);
const deleteExpiredOAuthStates = database.query<void, [number]>(
  "DELETE FROM anilist_oauth_states WHERE expires_at <= ?",
);
const countOAuthStates = database.query<{ readonly count: number }, []>(
  "SELECT COUNT(*) AS count FROM anilist_oauth_states",
);
const consumeOAuthState = database.transaction((stateHash: string): OAuthStateRow | null => {
  const state = findOAuthState.get(stateHash);
  deleteOAuthState.run(stateHash);
  return state;
});
const findAccount = database.query<AniListAccountRow, [number]>(`
  SELECT user_id, anilist_id, anilist_name, avatar_url, encrypted_token, token_expires_at
  FROM anilist_accounts WHERE user_id = ?
`);
const findAccountByAniListId = database.query<AniListAccountRow, [number]>(`
  SELECT user_id, anilist_id, anilist_name, avatar_url, encrypted_token, token_expires_at
  FROM anilist_accounts WHERE anilist_id = ?
`);
const upsertAccount = database.query<void, [number, number, string, string | null, string, number, number, number]>(`
  INSERT INTO anilist_accounts (
    user_id, anilist_id, anilist_name, avatar_url, encrypted_token,
    token_expires_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    anilist_id = excluded.anilist_id,
    anilist_name = excluded.anilist_name,
    avatar_url = excluded.avatar_url,
    encrypted_token = excluded.encrypted_token,
    token_expires_at = excluded.token_expires_at,
    updated_at = excluded.updated_at
`);
const deleteAccount = database.query<void, [number]>(
  "DELETE FROM anilist_accounts WHERE user_id = ?",
);
const deleteSyncProgress = database.query<void, [number]>(
  "DELETE FROM anilist_sync_progress WHERE user_id = ?",
);
const deleteMediaSyncProgress = database.query<void, [number, number]>(
  "DELETE FROM anilist_sync_progress WHERE user_id = ? AND media_id = ?",
);
const disconnectAccount = database.transaction((userId: number): void => {
  deleteAccount.run(userId);
  deleteSyncProgress.run(userId);
});
const findSyncProgress = database.query<SyncRow, [number, number]>(`
  SELECT progress, status FROM anilist_sync_progress WHERE user_id = ? AND media_id = ?
`);
const upsertSyncProgress = database.query<void, [number, number, number, string, number]>(`
  INSERT INTO anilist_sync_progress (user_id, media_id, progress, status, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(user_id, media_id) DO UPDATE SET
    progress = excluded.progress,
    status = excluded.status,
    updated_at = excluded.updated_at
`);

deleteExpiredOAuthStates.run(Date.now());

function oauthConfig(): OAuthConfig | null {
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
  const tokenKey = Buffer.from(encodedKey, "base64");
  if (!/^[A-Za-z\d+/]{43}=$/u.test(encodedKey) || tokenKey.byteLength !== 32) {
    throw new Error("NANIME_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  const redirect = URL.parse(redirectUri);
  if (redirect === null) {
    throw new Error("NANIME_ANILIST_REDIRECT_URI must be an absolute URL");
  }
  if (redirect.protocol !== "https:" && SECURE_COOKIES) {
    throw new Error("AniList OAuth requires an HTTPS redirect when secure cookies are enabled");
  }
  if (
    redirect.pathname !== "/api/auth/anilist/callback" ||
    redirect.search !== "" ||
    redirect.hash !== ""
  ) {
    throw new Error("NANIME_ANILIST_REDIRECT_URI must use the AniList callback path");
  }
  const publicOrigin = (process.env["NANIME_PUBLIC_ORIGIN"] ?? "").replace(/\/$/u, "");
  if (publicOrigin !== "" && publicOrigin !== redirect.origin) {
    throw new Error("AniList redirect and NANIME_PUBLIC_ORIGIN must use the same origin");
  }
  return { clientId, clientSecret, redirectUri: redirect.href, tokenKey, appOrigin: redirect.origin };
}
const OAUTH_CONFIG = oauthConfig();
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cookieValue(req: Request, name: string): string | null {
  const prefix = `${name}=`;
  const cookie = req.headers.get("cookie") ?? "";
  return cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function stateCookie(value: string, maxAge: number): string {
  const secure = SECURE_COOKIES ? "; Secure" : "";
  return `${STATE_COOKIE}=${value}; Path=/api/auth/anilist/callback; HttpOnly; SameSite=Lax; Max-Age=${String(maxAge)}${secure}`;
}

function sameValue(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function encryptToken(token: string, config: OAuthConfig): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.tokenKey, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

function decryptToken(value: string, config: OAuthConfig): string {
  const [version, encodedIv, encodedTag, encodedToken] = value.split(":");
  if (version !== "v1" || encodedIv === undefined || encodedTag === undefined || encodedToken === undefined) {
    throw new Error("Invalid encrypted AniList token");
  }
  const decipher = createDecipheriv("aes-256-gcm", config.tokenKey, Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedToken, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function graphQl<T>(token: string, query: string, variables: GraphQlVariables): Promise<T> {
  return aniListGraphQl<T>({ query, variables, token });
}

async function exchangeCode(code: string, config: OAuthConfig): Promise<{ readonly token: string; readonly expiresAt: number }> {
  const response = await fetch(ANILIST_TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
    }),
    signal: AbortSignal.timeout(ANILIST_REQUEST_TIMEOUT_MS),
  });
  const payload = (await response.json()) as TokenResponse;
  if (!response.ok || typeof payload.access_token !== "string" || typeof payload.expires_in !== "number") {
    throw new Error("AniList token exchange failed");
  }
  return { token: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
}

function appRedirect(config: OAuthConfig, result: string): Response {
  const location = new URL("/", config.appOrigin);
  location.searchParams.set("anilist", result);
  return new Response(null, {
    status: 303,
    headers: { location: location.href, "set-cookie": stateCookie("", 0) },
  });
}

export function aniListAuthConfigResponse(): Response {
  return Response.json({ enabled: OAUTH_CONFIG !== null });
}

export function startAniListAuthResponse(user: AuthUser | null): Response {
  const config = OAUTH_CONFIG;
  if (config === null) {
    return new Response("AniList login is not configured", { status: 503 });
  }
  deleteExpiredOAuthStates.run(Date.now());
  if ((countOAuthStates.get()?.count ?? 0) >= MAX_OAUTH_STATES) {
    return new Response("Too many pending AniList login requests", { status: 429 });
  }
  const state = randomBytes(32).toString("base64url");
  const now = Date.now();
  insertOAuthState.run(hash(state), user?.id ?? null, now + OAUTH_STATE_LIFETIME_MS, now);
  const authorize = new URL(ANILIST_AUTHORIZE_URL);
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", config.redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.href,
      "set-cookie": stateCookie(state, OAUTH_STATE_LIFETIME_MS / 1000),
      "cache-control": "no-store",
    },
  });
}

export async function aniListCallbackResponse(req: Request): Promise<Response> {
  const config = OAUTH_CONFIG;
  if (config === null) {
    return new Response("AniList login is not configured", { status: 503 });
  }
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const cookieState = cookieValue(req, STATE_COOKIE);
  const code = url.searchParams.get("code");
  if (
    state === null || !/^[A-Za-z\d_-]{43}$/u.test(state) ||
    cookieState === null || code === null || code.length > 4096 ||
    !sameValue(state, cookieState)
  ) {
    return appRedirect(config, "invalid-state");
  }
  const storedState = consumeOAuthState(hash(state));
  if (storedState === null || storedState.expires_at <= Date.now()) {
    return appRedirect(config, "expired-state");
  }
  try {
    const token = await exchangeCode(code, config);
    const viewerData = await graphQl<ViewerData>(
      token.token,
      `query { Viewer { id name avatar { large } } }`,
      {},
    );
    const viewer = viewerData.Viewer;
    if (storedState.user_id === null) {
      const account = findAccountByAniListId.get(viewer.id);
      if (account === null) {
        return appRedirect(config, "not-linked");
      }
      const now = Date.now();
      upsertAccount.run(
        account.user_id,
        viewer.id,
        viewer.name,
        viewer.avatar.large,
        encryptToken(token.token, config),
        token.expiresAt,
        now,
        now,
      );
      return createSessionRedirect(account.user_id, config.appOrigin);
    }
    const existing = findAccountByAniListId.get(viewer.id);
    if (existing !== null && existing.user_id !== storedState.user_id) {
      return appRedirect(config, "already-linked");
    }
    const now = Date.now();
    const currentAccount = findAccount.get(storedState.user_id);
    if (currentAccount !== null && currentAccount.anilist_id !== viewer.id) {
      deleteSyncProgress.run(storedState.user_id);
    }
    upsertAccount.run(
      storedState.user_id,
      viewer.id,
      viewer.name,
      viewer.avatar.large,
      encryptToken(token.token, config),
      token.expiresAt,
      now,
      now,
    );
    return appRedirect(config, "connected");
  } catch {
    return appRedirect(config, "failed");
  }
}

function accountToken(userId: number): { readonly row: AniListAccountRow; readonly token: string } | null {
  const config = OAUTH_CONFIG;
  const row = findAccount.get(userId);
  if (config === null || row === null || row.token_expires_at <= Date.now()) {
    return null;
  }
  return { row, token: decryptToken(row.encrypted_token, config) };
}

export function aniListAccountResponse(req: Request, user: AuthUser): Response {
  if (req.method === "DELETE") {
    disconnectAccount(user.id);
    return new Response(null, { status: 204 });
  }
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  const account = findAccount.get(user.id);
  return Response.json({
    configured: OAUTH_CONFIG !== null,
    connected: account !== null && account.token_expires_at > Date.now(),
    account: account === null ? null : {
      id: account.anilist_id,
      name: account.anilist_name,
      avatarUrl: account.avatar_url,
      expiresAt: account.token_expires_at,
    },
  });
}

async function fetchListEntry(token: string, mediaId: number): Promise<AniListListEntry | null> {
  const query = `query ($mediaId: Int!) {
    Media(id: $mediaId, type: ANIME) {
      mediaListEntry { id mediaId status progress score(format: POINT_10) }
    }
  }`;
  const data = await graphQl<MediaListData>(token, query, { mediaId });
  return data.Media?.mediaListEntry ?? null;
}

const LIST_STATUSES = new Set(["NONE", "CURRENT", "PLANNING", "COMPLETED", "DROPPED", "PAUSED", "REPEATING"]);

function validListUpdate(value: unknown): value is ListUpdate {
  const update = jsonObject(value);
  if (update === null) {
    return false;
  }
  const { status, progress, score } = update;
  return (status === undefined || typeof status === "string" && LIST_STATUSES.has(status)) &&
    (progress === undefined || Number.isInteger(progress) && (progress as number) >= 0) &&
    (score === undefined || typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 10) &&
    (status !== undefined || progress !== undefined || score !== undefined);
}

async function saveListEntry(
  token: string,
  mediaId: number,
  update: ListUpdate,
): Promise<AniListListEntry> {
  const argumentsList = ["mediaId: $mediaId"];
  const declarations = ["$mediaId: Int!"];
  const variables = new Map<string, number | string>([["mediaId", mediaId]]);
  if (update.status !== undefined) {
    argumentsList.push("status: $status");
    declarations.push("$status: MediaListStatus");
    variables.set("status", update.status);
  }
  if (update.progress !== undefined) {
    argumentsList.push("progress: $progress");
    declarations.push("$progress: Int");
    variables.set("progress", update.progress);
  }
  if (update.score !== undefined) {
    argumentsList.push("scoreRaw: $scoreRaw");
    declarations.push("$scoreRaw: Int");
    variables.set("scoreRaw", Math.round(update.score * 10));
  }
  const query = `mutation (${declarations.join(", ")}) {
    SaveMediaListEntry(${argumentsList.join(", ")}) {
      id mediaId status progress score(format: POINT_10)
    }
  }`;
  const data = await aniListGraphQl<SaveMediaListData>({
    query,
    variables: Object.fromEntries(variables),
    token,
    mutation: true,
  });
  return data.SaveMediaListEntry;
}

async function deleteListEntry(token: string, entryId: number): Promise<void> {
  const query = `mutation ($id: Int!) {
    DeleteMediaListEntry(id: $id) { deleted }
  }`;
  const data = await aniListGraphQl<DeleteMediaListData>({
    query,
    variables: { id: entryId },
    token,
    mutation: true,
  });
  if (!data.DeleteMediaListEntry.deleted) {
    throw new Error("AniList list entry was not deleted");
  }
}

function mediaIdFromUrl(url: URL): number | null {
  const value = Number(url.pathname.slice("/api/anilist/list/".length));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function aniListEntryResponse(req: Request, url: URL, user: AuthUser): Promise<Response> {
  const mediaId = mediaIdFromUrl(url);
  const account = accountToken(user.id);
  if (mediaId === null) {
    return new Response("Invalid AniList media ID", { status: 400 });
  }
  if (account === null) {
    return new Response("Connect AniList first", { status: 409 });
  }
  if (req.method === "GET") {
    return Response.json(await fetchListEntry(account.token, mediaId));
  }
  if (req.method !== "PUT") {
    return new Response("Method not allowed", { status: 405 });
  }
  const body: unknown = await req.json().catch((): null => null);
  if (!validListUpdate(body)) {
    return new Response("Invalid AniList list update", { status: 400 });
  }
  if (body.status === "NONE") {
    const current = await fetchListEntry(account.token, mediaId);
    if (current !== null) {
      await deleteListEntry(account.token, current.id);
    }
    deleteMediaSyncProgress.run(user.id, mediaId);
    return Response.json(null);
  }
  const result = await saveListEntry(account.token, mediaId, body);
  upsertSyncProgress.run(user.id, mediaId, result.progress, result.status, Date.now());
  return Response.json(result);
}
export async function syncAniListPlayback(userId: number, target: AniListPlaybackTarget): Promise<void> {
  if (!Number.isInteger(target.mediaId) || !Number.isInteger(target.episode) || target.episode <= 0) {
    return;
  }
  const account = accountToken(userId);
  if (account === null) {
    return;
  }
  const desiredProgress = target.completed ? target.episode : Math.max(0, target.episode - 1);
  const desiredStatus = target.completed && target.totalEpisodes !== null &&
      target.episode >= target.totalEpisodes
    ? "COMPLETED"
    : "CURRENT";
  let previous = findSyncProgress.get(userId, target.mediaId);
  if (previous === null) {
    const remote = await fetchListEntry(account.token, target.mediaId);
    previous = remote === null ? null : { progress: remote.progress, status: remote.status };
    if (remote !== null) {
      upsertSyncProgress.run(userId, target.mediaId, remote.progress, remote.status, Date.now());
    }
  }
  if (target.allowDecrease === true && !target.completed) {
    if (previous === null || previous.progress !== target.episode) {
      return;
    }
    const result = await saveListEntry(account.token, target.mediaId,
      { progress: desiredProgress, status: "CURRENT" });
    upsertSyncProgress.run(userId, target.mediaId, result.progress, result.status, Date.now());
    return;
  }
  const progress = Math.max(previous?.progress ?? 0, desiredProgress);
  if (previous !== null && previous.progress >= desiredProgress && (
    previous.status === "COMPLETED" || previous.status === desiredStatus
  )) {
    return;
  }
  const status = previous?.status === "COMPLETED" ? "COMPLETED" : desiredStatus;
  const result = await saveListEntry(account.token, target.mediaId, { progress, status });
  upsertSyncProgress.run(userId, target.mediaId, result.progress, result.status, Date.now());
}
