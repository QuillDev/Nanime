import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { database } from "./database.ts";

const SESSION_COOKIE = "nanime_session";
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const MINIMUM_PASSWORD_LENGTH = 15;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 5;
const CLIENT_ATTEMPT_LIMIT = 50;
const MAX_ATTEMPT_KEYS = 10_000;
const SECURE_COOKIES = process.env["NANIME_SECURE_COOKIES"] !== "false";
const DUMMY_PASSWORD_HASH = Bun.password.hashSync(randomBytes(32), "argon2id");

interface UserRow {
  readonly id: number;
  readonly username: string;
  readonly password_hash: string | null;
  readonly setup_token_hash: string | null;
  readonly is_admin: number;
}

export interface AuthUser {
  readonly id: number;
  readonly username: string;
  readonly isAdmin: boolean;
}

interface Credentials {
  readonly username?: unknown;
  readonly password?: unknown;
  readonly setupToken?: unknown;
}

interface LoginAttempts {
  readonly count: number;
  readonly resetAt: number;
}

const loginAttempts = new Map<string, LoginAttempts>();

const findUser = database.query<UserRow, [string]>(`
  SELECT id, username, password_hash, setup_token_hash, is_admin FROM users WHERE username = ?
`);
const findSessionUser = database.query<UserRow, [string, number]>(`
  SELECT users.id, users.username, users.password_hash, users.setup_token_hash, users.is_admin
  FROM sessions JOIN users ON users.id = sessions.user_id
  WHERE sessions.token_hash = ? AND sessions.expires_at > ?
`);
const insertSession = database.query<void, [string, number, number, number]>(`
  INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)
`);
const deleteSession = database.query<void, [string]>("DELETE FROM sessions WHERE token_hash = ?");
const setPassword = database.query<void, [string, number]>(`
  UPDATE users SET password_hash = ?, setup_token_hash = NULL
  WHERE id = ? AND password_hash IS NULL
`);
const findUserById = database.query<UserRow, [number]>(`
  SELECT id, username, password_hash, setup_token_hash, is_admin FROM users WHERE id = ?
`);
database.query("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());

function publicUser(row: UserRow): AuthUser {
  return { id: row.id, username: row.username, isAdmin: row.is_admin === 1 };
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieValue(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const prefix = `${SESSION_COOKIE}=`;
  const item = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return item?.slice(prefix.length) ?? null;
}

function sessionCookie(token: string, maxAge: number): string {
  const secure = SECURE_COOKIES ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${String(maxAge)}; Priority=High${secure}`;
}

function createSession(user: UserRow): Response {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  insertSession.run(tokenHash(token), user.id, now + SESSION_LIFETIME_MS, now);
  return Response.json(publicUser(user), {
    headers: { "set-cookie": sessionCookie(token, SESSION_LIFETIME_MS / 1000) },
  });
}

export function createSessionRedirect(userId: number, location: string): Response {
  const user = findUserById.get(userId);
  if (user === null) {
    return Response.redirect(`${location}?anilist=account-missing`, 303);
  }
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  insertSession.run(tokenHash(token), user.id, now + SESSION_LIFETIME_MS, now);
  return new Response(null, {
    status: 303,
    headers: {
      location,
      "set-cookie": sessionCookie(token, SESSION_LIFETIME_MS / 1000),
    },
  });
}

async function credentials(req: Request): Promise<Credentials | null> {
  return (await req.json().catch(() => null)) as Credentials | null;
}

function validUsername(value: unknown): value is string {
  return typeof value === "string" && /^[\p{L}\p{N}_-]{2,32}$/u.test(value);
}

function validPassword(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= MINIMUM_PASSWORD_LENGTH &&
    value.length <= 256;
}

function validLoginPassword(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function validSetupToken(value: unknown): value is string {
  return typeof value === "string" && value.length <= 256;
}

export function authenticatedUser(req: Request): AuthUser | null {
  const token = cookieValue(req);
  if (token === null) {
    return null;
  }
  const row = findSessionUser.get(tokenHash(token), Date.now());
  return row === null ? null : publicUser(row);
}

function attemptKeys(clientAddress: string, username: string): readonly [string, string] {
  return [`client:${clientAddress}`, `account:${clientAddress}\0${username.toLocaleLowerCase()}`];
}

function isRateLimited(key: string, limit: number): boolean {
  const attempt = loginAttempts.get(key);
  if (attempt === undefined) {
    return false;
  }
  if (attempt.resetAt <= Date.now()) {
    loginAttempts.delete(key);
    return false;
  }
  return attempt.count >= limit;
}

function recordFailure(keys: readonly string[]): void {
  for (const key of keys) {
    const previous = loginAttempts.get(key);
    loginAttempts.set(key, previous === undefined || previous.resetAt <= Date.now()
      ? { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS }
      : { ...previous, count: previous.count + 1 });
  }
  if (loginAttempts.size > MAX_ATTEMPT_KEYS) {
    const oldest = loginAttempts.keys().next().value;
    if (oldest !== undefined) {
      loginAttempts.delete(oldest);
    }
  }
}

function attemptsExceeded(keys: readonly [string, string]): boolean {
  return isRateLimited(keys[0], CLIENT_ATTEMPT_LIMIT) ||
    isRateLimited(keys[1], LOGIN_ATTEMPT_LIMIT);
}

function clearAttempts(keys: readonly string[]): void {
  for (const key of keys) {
    loginAttempts.delete(key);
  }
}

function tokenMatches(value: string, expectedHash: string): boolean {
  const actual = Buffer.from(tokenHash(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

async function setupPassword(req: Request, clientAddress: string): Promise<Response> {
  const body = await credentials(req);
  if (
    body === null ||
    !validUsername(body.username) ||
    !validPassword(body.password) ||
    !validSetupToken(body.setupToken)
  ) {
    return new Response(`Password must be ${String(MINIMUM_PASSWORD_LENGTH)}–256 characters`, {
      status: 400,
    });
  }
  const keys = attemptKeys(clientAddress, body.username);
  if (attemptsExceeded(keys)) {
    return new Response("Too many attempts; try again later", { status: 429 });
  }
  const user = findUser.get(body.username);
  if (
    user === null ||
    user.password_hash !== null ||
    user.setup_token_hash === null ||
    !tokenMatches(body.setupToken, user.setup_token_hash)
  ) {
    recordFailure(keys);
    return new Response("Invalid account or setup code", { status: 401 });
  }
  const hash = await Bun.password.hash(body.password, "argon2id");
  const result = setPassword.run(hash, user.id);
  if (result.changes !== 1) {
    return new Response("Password setup is no longer available", { status: 409 });
  }
  clearAttempts(keys);
  return createSession({ ...user, password_hash: hash, setup_token_hash: null });
}

async function login(req: Request, clientAddress: string): Promise<Response> {
  const body = await credentials(req);
  if (body === null || !validUsername(body.username) || !validLoginPassword(body.password)) {
    return new Response("Invalid username or password", { status: 401 });
  }
  const keys = attemptKeys(clientAddress, body.username);
  if (attemptsExceeded(keys)) {
    return new Response("Too many attempts; try again later", { status: 429 });
  }
  const user = findUser.get(body.username);
  const hash = user?.password_hash ?? DUMMY_PASSWORD_HASH;
  const valid = await Bun.password.verify(body.password, hash);
  if (!valid || user === null || user.password_hash === null) {
    recordFailure(keys);
    return new Response("Invalid username or password", { status: 401 });
  }
  clearAttempts(keys);
  return createSession(user);
}

function logout(req: Request): Response {
  const token = cookieValue(req);
  if (token !== null) {
    deleteSession.run(tokenHash(token));
  }
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": sessionCookie("", 0) },
  });
}

export function authResponse(
  pathname: string,
  req: Request,
  clientAddress: string,
): Response | Promise<Response> | null {
  if (pathname === "/api/auth/me" && req.method === "GET") {
    return Response.json(authenticatedUser(req));
  }
  if (pathname === "/api/auth/setup" && req.method === "POST") {
    return setupPassword(req, clientAddress);
  }
  if (pathname === "/api/auth/login" && req.method === "POST") {
    return login(req, clientAddress);
  }
  if (pathname === "/api/auth/logout" && req.method === "POST") {
    return logout(req);
  }
  return pathname.startsWith("/api/auth/")
    ? new Response("Method not allowed", { status: 405 })
    : null;
}

interface UserListRow {
  readonly id: number;
  readonly username: string;
  readonly is_admin: number;
  readonly password_set: number;
}

interface UserSetupRow {
  readonly password_set: number;
}

const listUsers = database.query<UserListRow, []>(`
  SELECT id, username, is_admin, password_hash IS NOT NULL AS password_set
  FROM users ORDER BY username COLLATE NOCASE
`);
const insertUser = database.query<void, [string, string, number, number]>(`
  INSERT INTO users (username, setup_token_hash, is_admin, created_at) VALUES (?, ?, ?, ?)
`);
const findUserSetup = database.query<UserSetupRow, [number]>(`
  SELECT password_hash IS NOT NULL AS password_set FROM users WHERE id = ?
`);
const deletePendingUser = database.query<void, [number]>(`
  DELETE FROM users WHERE id = ? AND password_hash IS NULL
`);

export function usersResponse(
  req: Request,
  user: AuthUser,
  requestedUserId: number | null = null,
): Response | Promise<Response> {
  if (!user.isAdmin) {
    return new Response("Forbidden", { status: 403 });
  }
  if (requestedUserId !== null) {
    return req.method === "DELETE"
      ? cancelProvision(requestedUserId, user.id)
      : new Response("Method not allowed", { status: 405 });
  }
  if (req.method === "GET") {
    return Response.json(listUsers.all().map((row) => ({
      id: row.id,
      username: row.username,
      isAdmin: row.is_admin === 1,
      passwordSet: row.password_set === 1,
    })));
  }
  return req.method === "POST"
    ? provisionUser(req)
    : new Response("Method not allowed", { status: 405 });
}

function cancelProvision(userId: number, currentUserId: number): Response {
  if (!Number.isInteger(userId) || userId <= 0) {
    return new Response("Invalid user ID", { status: 400 });
  }
  if (userId === currentUserId) {
    return new Response("Cannot cancel your own account", { status: 409 });
  }
  const target = findUserSetup.get(userId);
  if (target === null) {
    return new Response("User not found", { status: 404 });
  }
  if (target.password_set === 1) {
    return new Response("Only pending provisions can be cancelled", { status: 409 });
  }
  deletePendingUser.run(userId);
  return new Response(null, { status: 204 });
}

async function provisionUser(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    readonly username?: unknown;
    readonly isAdmin?: unknown;
  } | null;
  if (body === null || !validUsername(body.username) || typeof body.isAdmin !== "boolean") {
    return new Response("Invalid user", { status: 400 });
  }
  try {
    const setupToken = randomBytes(24).toString("base64url");
    insertUser.run(body.username, tokenHash(setupToken), body.isAdmin ? 1 : 0, Date.now());
    return Response.json({ setupToken }, { status: 201 });
  } catch {
    return new Response("Username already exists", { status: 409 });
  }
}
