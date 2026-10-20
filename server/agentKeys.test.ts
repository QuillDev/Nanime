import { afterEach, expect, test } from "bun:test";
import type { AgentKey } from "../shared/types.ts";
import { getJson, startLibraryTestServer, statusOf, viewerCookie, type LibraryTestServer } from "./libraryFilesTestServer.ts";

let server: LibraryTestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

interface Overview {
  readonly keys: readonly AgentKey[];
  readonly mcp: { readonly command: string; readonly args: readonly string[] };
}

async function create(target: LibraryTestServer, name: string): Promise<{ readonly key: string; readonly agentKey: AgentKey }> {
  const response = await target.request("/api/agent-keys", { method: "POST", json: { name } });
  expect(response.status).toBe(201);
  return await response.json() as { readonly key: string; readonly agentKey: AgentKey };
}

type KeyedRequest = (path: string, json?: unknown) => Promise<Response>;

/** Requests as the MCP server sends them: the key, no cookie and no Origin; a JSON body makes it a POST. */
function keyed(target: LibraryTestServer, key: string): KeyedRequest {
  return (path, json) => {
    const headers = new Headers({ authorization: `Bearer ${key}`, "content-type": "application/json" });
    const init = json === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(json) };
    return fetch(`${target.origin}${path}`, init);
  };
}

test("an agent key acts as the admin who made it, shows when it was used, and stops working once revoked", async () => {
  server = await startLibraryTestServer();
  const target = server;
  const { key, agentKey } = await create(target, "Hermes");
  expect(agentKey).toMatchObject({ name: "Hermes", createdBy: "admin", lastUsedAt: null });

  const agent = keyed(target, key);
  const me = await agent("/api/auth/me");
  expect(await me.json()).toMatchObject({ username: "admin", isAdmin: true });
  // Writes need no Origin header with a key: browsers can't attach one cross-site.
  const magnet = `magnet:?xt=urn:btih:${"ab".repeat(20)}`;
  const added = await agent("/api/downloads", { showFolder: "", items: [{ kind: "torrent", magnet }] });
  expect(await added.json()).toEqual({ added: 1 });

  const listed = await getJson<Overview>(target, "/api/agent-keys");
  expect(listed.keys.map((entry) => [entry.name, entry.lastUsedAt === null])).toEqual([["Hermes", false]]);
  expect(listed.mcp.args.at(-1)).toEndWith("server/mcp.ts");

  const revoked = await target.request(`/api/agent-keys/${String(agentKey.id)}`, { method: "DELETE" });
  expect(revoked.status).toBe(204);
  expect(await statusOf(agent("/api/downloads"))).toBe(401);
  const after = await getJson<Overview>(target, "/api/agent-keys");
  expect(after.keys).toEqual([]);
}, 60_000);

test("a key can't manage keys or users, made-up keys are refused, and viewers can't make keys", async () => {
  server = await startLibraryTestServer();
  const target = server;
  const { key } = await create(target, "Hermes");

  const agent = keyed(target, key);
  expect(await statusOf(agent("/api/agent-keys"))).toBe(403);
  expect(await statusOf(agent("/api/agent-keys", { name: "Another" }))).toBe(403);
  expect(await statusOf(agent("/api/users"))).toBe(403);
  const forged = keyed(target, `${key}x`);
  expect(await statusOf(forged("/api/downloads"))).toBe(401);

  const viewer = await viewerCookie(target);
  expect(await statusOf(target.request("/api/agent-keys", { method: "POST", json: { name: "Mine" }, cookie: viewer }))).toBe(403);
  expect(await statusOf(target.request("/api/agent-keys", { method: "POST", json: { name: "   " } }))).toBe(400);
}, 60_000);
