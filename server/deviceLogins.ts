import { createHash, randomBytes, randomInt } from "node:crypto";
import type { AuthUser } from "../shared/types.ts";
import { usesAgentKey } from "./agentKeys.ts";
import { database } from "./database.ts";

/**
 * Signing in a TV from a signed-in phone (the OAuth device flow, RFC 8628):
 * the TV asks for a code and shows it as a QR code, the phone opens
 * `/link?code=…` and approves it, and the TV's next poll gets a session for
 * the user who approved. The TV holds a secret device code; the short user
 * code only names the request on the approval page.
 */
const LIFETIME_MS = 10 * 60 * 1000;
const POLL_INTERVAL_SECONDS = 2;
// Unambiguous on a TV screen: no 0/O, 1/I/L, 2/Z, 5/S, 8/B.
const USER_CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";
const USER_CODE_LENGTH = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const START_LIMIT = 30;
const APPROVE_FAILURE_LIMIT = 10;
const MAX_PENDING = 500;

interface PendingRow {
  readonly user_code: string;
  readonly device: string;
  readonly created_at: number;
  readonly expires_at: number;
}

interface PollRow {
  readonly user_id: number | null;
}

const removeExpired = database.query<void, [number]>("DELETE FROM device_logins WHERE expires_at <= ?");
const countPending = database.query<{ readonly count: number }, []>("SELECT COUNT(*) AS count FROM device_logins");
const insertRequest = database.query<void, [string, string, string, number, number]>(`
  INSERT INTO device_logins (device_hash, user_code, device, created_at, expires_at) VALUES (?, ?, ?, ?, ?)
`);
const findPending = database.query<PendingRow, [string, number]>(`
  SELECT user_code, device, created_at, expires_at FROM device_logins
  WHERE user_code = ? AND expires_at > ? AND user_id IS NULL
`);
const approveRequest = database.query<{ readonly user_code: string }, [number, string, number]>(`
  UPDATE device_logins SET user_id = ? WHERE user_code = ? AND expires_at > ? AND user_id IS NULL
  RETURNING user_code
`);
const findPoll = database.query<PollRow, [string, number]>(`
  SELECT user_id FROM device_logins WHERE device_hash = ? AND expires_at > ?
`);
// Single use: whichever poll removes the approved row gets the session.
const claimApproved = database.query<{ readonly user_id: number }, [string, number]>(`
  DELETE FROM device_logins WHERE device_hash = ? AND expires_at > ? AND user_id IS NOT NULL
  RETURNING user_id
`);

const attempts = new Map<string, { readonly count: number; readonly resetAt: number }>();

function overLimit(key: string, limit: number): boolean {
  const entry = attempts.get(key);
  return entry !== undefined && entry.resetAt > Date.now() && entry.count >= limit;
}

function countAttempt(key: string): void {
  const entry = attempts.get(key);
  const now = Date.now();
  attempts.set(key, entry === undefined || entry.resetAt <= now
    ? { count: 1, resetAt: now + ATTEMPT_WINDOW_MS }
    : { ...entry, count: entry.count + 1 });
  if (attempts.size > 10_000) {
    attempts.clear();
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function newUserCode(): string {
  return Array.from({ length: USER_CODE_LENGTH }, () => USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]).join("");
}

/** Accepts the code as typed or scanned: any case, with or without the dash. */
export function normalizeUserCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.replaceAll(/[\s-]/gu, "").toUpperCase() : "";
  return code.length === USER_CODE_LENGTH && [...code].every((char) => USER_CODE_ALPHABET.includes(char)) ? code : null;
}

/** What the approval page calls the device asking to sign in. */
function deviceName(req: Request): string {
  const agent = req.headers.get("user-agent") ?? "";
  if (agent.includes("NanimeTV/")) {
    return "Android TV";
  }
  return agent.includes("NanimeAndroid/") ? "Android app" : "Web browser";
}

function startResponse(req: Request, clientAddress: string): Response {
  const key = `start:${clientAddress}`;
  if (overLimit(key, START_LIMIT)) {
    return new Response("Too many sign-in codes; try again later", { status: 429 });
  }
  countAttempt(key);
  const now = Date.now();
  removeExpired.run(now);
  if ((countPending.get()?.count ?? 0) >= MAX_PENDING) {
    return new Response("Too many sign-in codes; try again later", { status: 429 });
  }
  const deviceCode = randomBytes(32).toString("base64url");
  const userCode = newUserCode();
  insertRequest.run(hash(deviceCode), userCode, deviceName(req), now, now + LIFETIME_MS);
  return Response.json({ deviceCode, userCode, expiresAt: now + LIFETIME_MS, interval: POLL_INTERVAL_SECONDS });
}

interface DeviceLoginBody {
  readonly deviceCode?: unknown;
  readonly userCode?: unknown;
}

async function readBody(req: Request): Promise<DeviceLoginBody> {
  return (await req.json().catch(() => null)) as DeviceLoginBody | null ?? {};
}

type SessionFor = (userId: number) => Response;

async function pollResponse(req: Request, sessionFor: SessionFor): Promise<Response> {
  const { deviceCode } = await readBody(req);
  if (typeof deviceCode !== "string" || deviceCode.length > 100) {
    return Response.json({ status: "expired" });
  }
  const now = Date.now();
  const row = findPoll.get(hash(deviceCode), now);
  if (row === null) {
    return Response.json({ status: "expired" });
  }
  if (row.user_id === null) {
    return Response.json({ status: "pending" });
  }
  const claimed = claimApproved.get(hash(deviceCode), now);
  return claimed === null ? Response.json({ status: "expired" }) : sessionFor(claimed.user_id);
}

function lookupResponse(code: string | null): Response {
  const row = code === null ? null : findPending.get(code, Date.now());
  return row === null
    ? new Response("This code has expired or was already used", { status: 404 })
    : Response.json({ userCode: row.user_code, device: row.device, createdAt: row.created_at, expiresAt: row.expires_at });
}

async function approveResponse(req: Request, user: AuthUser): Promise<Response> {
  const key = `approve:${String(user.id)}`;
  if (overLimit(key, APPROVE_FAILURE_LIMIT)) {
    return new Response("Too many attempts; try again later", { status: 429 });
  }
  const body = await readBody(req);
  const code = normalizeUserCode(body.userCode);
  const approved = code === null ? null : approveRequest.get(user.id, code, Date.now());
  if (approved === null) {
    countAttempt(key);
    return new Response("This code has expired or was already used", { status: 404 });
  }
  return new Response(null, { status: 204 });
}

/** Signed-in browser sessions only: an agent key can't hand out sessions. */
function signedInAction(req: Request, user: AuthUser | null, action: (user: AuthUser) => Response | Promise<Response>): Response | Promise<Response> {
  if (user === null) {
    return new Response("Unauthorized", { status: 401 });
  }
  return usesAgentKey(req) ? new Response("Forbidden", { status: 403 }) : action(user);
}

export interface DeviceLoginContext {
  readonly clientAddress: string;
  readonly user: AuthUser | null;
  readonly sessionFor: SessionFor;
}

/** `/api/auth/device…`: start and poll (the TV, signed out), look up and approve (the phone, signed in). */
export function deviceLoginResponse(pathname: string, req: Request, context: DeviceLoginContext): Response | Promise<Response> | null {
  const route = `${req.method} ${pathname}`;
  if (route === "POST /api/auth/device") {
    return startResponse(req, context.clientAddress);
  }
  if (route === "POST /api/auth/device/poll") {
    return pollResponse(req, context.sessionFor);
  }
  if (route === "POST /api/auth/device/approve") {
    return signedInAction(req, context.user, (user) => approveResponse(req, user));
  }
  if (req.method === "GET" && pathname.startsWith("/api/auth/device/")) {
    const code = normalizeUserCode(pathname.slice("/api/auth/device/".length));
    return signedInAction(req, context.user, () => lookupResponse(code));
  }
  return null;
}
