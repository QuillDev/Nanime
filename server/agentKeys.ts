import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { isPreferredAudioLanguage } from "../shared/audioLanguage.ts";
import type { AgentKey, AuthUser } from "../shared/types.ts";
import { database } from "./database.ts";

/**
 * Agent keys: long-lived bearer credentials an admin creates for an agent
 * (the MCP server in `server/mcp.ts`). A key acts as the admin who made it,
 * with that admin's current rights, and stops working when it is revoked or
 * the admin is removed. Keys can't manage keys or users.
 */
const KEY_PREFIX = "nanime_";
const MAX_NAME_LENGTH = 60;
const LAST_USED_RESOLUTION_MS = 60_000;

interface KeyUserRow {
  readonly key_id: number;
  readonly last_used_at: number | null;
  readonly id: number;
  readonly username: string;
  readonly is_admin: number;
  readonly preferred_audio_language: string | null;
}

interface KeyRow {
  readonly id: number;
  readonly name: string;
  readonly username: string;
  readonly created_at: number;
  readonly last_used_at: number | null;
}

const findKeyUser = database.query<KeyUserRow, [string]>(`
  SELECT agent_keys.id AS key_id, agent_keys.last_used_at, users.id, users.username, users.is_admin, users.preferred_audio_language
  FROM agent_keys JOIN users ON users.id = agent_keys.user_id
  WHERE agent_keys.key_hash = ?
`);
const markUsed = database.query<void, [number, number]>("UPDATE agent_keys SET last_used_at = ? WHERE id = ?");
const listKeys = database.query<KeyRow, []>(`
  SELECT agent_keys.id, agent_keys.name, users.username, agent_keys.created_at, agent_keys.last_used_at
  FROM agent_keys JOIN users ON users.id = agent_keys.user_id
  ORDER BY agent_keys.created_at DESC, agent_keys.id DESC
`);
const insertKey = database.query<KeyRow, [string, string, number, number]>(`
  INSERT INTO agent_keys (name, key_hash, user_id, created_at) VALUES (?, ?, ?, ?)
  RETURNING id, name, (SELECT username FROM users WHERE users.id = user_id) AS username, created_at, last_used_at
`);
const deleteKey = database.query<{ readonly id: number }, [number]>("DELETE FROM agent_keys WHERE id = ? RETURNING id");

function keyHash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function bearerKey(req: Request): string | null {
  const value = req.headers.get("authorization") ?? "";
  const key = value.startsWith("Bearer ") ? value.slice(7).trim() : "";
  return key.startsWith(KEY_PREFIX) ? key : null;
}

/** Whether the request presents an agent key rather than a browser session. */
export function usesAgentKey(req: Request): boolean {
  return bearerKey(req) !== null && !req.headers.has("cookie");
}

/** The admin an agent key acts as, or null. Notes the use at most once a minute. */
export function agentKeyUser(req: Request): AuthUser | null {
  const key = bearerKey(req);
  const row = key === null ? null : findKeyUser.get(keyHash(key));
  if (row === null) {
    return null;
  }
  const now = Date.now();
  if (row.last_used_at === null || now - row.last_used_at >= LAST_USED_RESOLUTION_MS) {
    markUsed.run(now, row.key_id);
  }
  const language = row.preferred_audio_language;
  return { id: row.id, username: row.username, isAdmin: row.is_admin === 1, preferredAudioLanguage: isPreferredAudioLanguage(language) ? language : null };
}

function keyView(row: KeyRow): AgentKey {
  return { id: row.id, name: row.name, createdBy: row.username, createdAt: row.created_at, lastUsedAt: row.last_used_at };
}

/** How an agent starts the MCP server on this host: this runtime and this checkout. */
function mcpCommand() {
  return { command: process.execPath, args: ["run", join(import.meta.dir, "mcp.ts")] };
}

interface CreateBody {
  readonly name?: unknown;
}

async function createResponse(req: Request, user: AuthUser): Promise<Response> {
  const body = (await req.json().catch(() => null)) as CreateBody | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name === "" || name.length > MAX_NAME_LENGTH) {
    return new Response("Name the key", { status: 400 });
  }
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const row = insertKey.get(name, keyHash(key), user.id, Date.now());
  return row === null ? new Response("Server error", { status: 500 }) : Response.json({ key, agentKey: keyView(row) }, { status: 201 });
}

function revokeResponse(id: number): Response {
  const removed = Number.isSafeInteger(id) && id > 0 ? deleteKey.get(id) : null;
  return removed === null ? new Response("Key not found", { status: 404 }) : new Response(null, { status: 204 });
}

/** `/api/agent-keys`: list, create and revoke. Admins in a browser only. */
export function agentKeysResponse(req: Request, user: AuthUser, pathname: string): Response | Promise<Response> {
  if (!user.isAdmin || usesAgentKey(req)) {
    return new Response("Forbidden", { status: 403 });
  }
  if (pathname !== "/api/agent-keys") {
    return req.method === "DELETE" ? revokeResponse(Number(pathname.slice("/api/agent-keys/".length))) : new Response("Method not allowed", { status: 405 });
  }
  if (req.method === "GET") {
    return Response.json({ keys: listKeys.all().map((row) => keyView(row)), mcp: mcpCommand() });
  }
  return req.method === "POST" ? createResponse(req, user) : new Response("Method not allowed", { status: 405 });
}
