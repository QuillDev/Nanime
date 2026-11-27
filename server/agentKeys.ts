import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { isPreferredAudioLanguage } from "../shared/audioLanguage.ts";
import type { AgentKey, AuthUser } from "../shared/types.ts";
import { z } from "zod";
import { AgentKeyRowSchema, db, execute, queryOne, queryRows, sql, UserRowSchema } from "./database.ts";

/**
 * Agent keys: long-lived bearer credentials an admin creates for an agent
 * (the MCP server in `server/mcp.ts`). A key acts as the admin who made it,
 * with that admin's current rights, and stops working when it is revoked or
 * the admin is removed. Keys can't manage keys or users.
 */
const KEY_PREFIX = "nanime_";
const MAX_NAME_LENGTH = 60;
const LAST_USED_RESOLUTION_MS = 60_000;

const KeyUserRowSchema = UserRowSchema.pick({ id: true, username: true, is_admin: true, preferred_audio_language: true })
  .extend({ key_id: z.number(), last_used_at: z.number().nullable() });
const KeyRowSchema = AgentKeyRowSchema.pick({ id: true, name: true, created_at: true, last_used_at: true })
  .extend({ username: z.string() });
type KeyRow = z.infer<typeof KeyRowSchema>;

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
  const row = key === null ? null : queryOne(db.selectFrom("agent_keys").innerJoin("users", "users.id", "agent_keys.user_id")
    .select(["agent_keys.id as key_id", "agent_keys.last_used_at", "users.id", "users.username", "users.is_admin", "users.preferred_audio_language"])
    .where("agent_keys.key_hash", "=", keyHash(key)), KeyUserRowSchema);
  if (row === null) {
    return null;
  }
  const now = Date.now();
  if (row.last_used_at === null || now - row.last_used_at >= LAST_USED_RESOLUTION_MS) {
    execute(db.updateTable("agent_keys").set({ last_used_at: now }).where("id", "=", row.key_id));
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
  const row = queryOne(sql`
    INSERT INTO agent_keys (name, key_hash, user_id, created_at) VALUES (${name}, ${keyHash(key)}, ${user.id}, ${Date.now()})
    RETURNING id, name, (SELECT username FROM users WHERE users.id = user_id) AS username, created_at, last_used_at
  `, KeyRowSchema);
  return row === null ? new Response("Server error", { status: 500 }) : Response.json({ key, agentKey: keyView(row) }, { status: 201 });
}

function revokeResponse(id: number): Response {
  const removed = Number.isSafeInteger(id) && id > 0 ? execute(db.deleteFrom("agent_keys").where("id", "=", id)) : 0;
  return removed === 0 ? new Response("Key not found", { status: 404 }) : new Response(null, { status: 204 });
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
    const keys = queryRows(db.selectFrom("agent_keys").innerJoin("users", "users.id", "agent_keys.user_id")
      .select(["agent_keys.id", "agent_keys.name", "users.username", "agent_keys.created_at", "agent_keys.last_used_at"])
      .orderBy("agent_keys.created_at", "desc").orderBy("agent_keys.id", "desc"), KeyRowSchema);
    return Response.json({ keys: keys.map((row) => keyView(row)), mcp: mcpCommand() });
  }
  return req.method === "POST" ? createResponse(req, user) : new Response("Method not allowed", { status: 405 });
}
