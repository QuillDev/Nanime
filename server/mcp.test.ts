import { afterEach, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getJson, startLibraryTestServer, type LibraryTestServer } from "./libraryFilesTestServer.ts";
import { waitUntil } from "./testProcess.ts";
import { SHOW_TITLE, publishFakeRepository } from "./testSourcePlugins.ts";
import { startFakeSource, type FakeSource } from "./testSource.ts";

let server: LibraryTestServer | null = null;
let site: FakeSource | null = null;
let client: Client | null = null;

afterEach(async () => {
  await client?.close();
  await server?.close();
  site?.stop();
  client = null;
  server = null;
  site = null;
});

interface Setup {
  readonly target: LibraryTestServer;
  readonly lantern: string;
}

/** A Nanime with the fictional repository's Lantern Stream source installed. */
async function withLanternSource(): Promise<Setup> {
  server = await startLibraryTestServer(async () => {}, { env: { NANIME_SOURCE_ALLOW_PRIVATE_NETWORK: "1", NANIME_SOURCE_CALL_TIMEOUT_MS: "3000" } });
  site = await startFakeSource();
  const repo = await publishFakeRepository(site);
  await server.request("/api/sources/repos", { method: "POST", json: { url: repo.indexUrl } });
  const lantern = repo.ids["Lantern Stream"] ?? "";
  const installed = await server.request("/api/sources/install", { method: "POST", json: { id: lantern } });
  expect(installed.status).toBe(200);
  return { target: server, lantern };
}

/** An agent key created the way an admin does in Admin → Agents. */
async function agentKey(target: LibraryTestServer): Promise<string> {
  const created = await target.request("/api/agent-keys", { method: "POST", json: { name: "Hermes" } });
  const { key } = await created.json() as { readonly key: string };
  return key;
}

/** The MCP server as an agent runs it: its own process over stdio, signed with an agent key. */
async function connect(target: LibraryTestServer, key: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(import.meta.dir, "mcp.ts")],
    env: { NANIME_URL: target.origin, NANIME_KEY: key },
    stderr: "pipe",
  });
  client = new Client({ name: "nanime-mcp-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

interface ToolAnswer {
  readonly isError: boolean;
  readonly value: unknown;
}

type ToolArguments = Readonly<Record<string, string | number | readonly number[]>>;

async function call(agent: Client, name: string, args: ToolArguments = {}): Promise<ToolAnswer> {
  const result = await agent.callTool({ name, arguments: args });
  const [first] = result.content as readonly { readonly text: string }[];
  const text = first?.text ?? "";
  return result.isError === true ? { isError: true, value: text } : { isError: false, value: JSON.parse(text) as unknown };
}

test("an agent searches every installed source and queues a show's episode into the library", async () => {
  const { target, lantern } = await withLanternSource();
  const key = await agentKey(target);
  const agent = await connect(target, key);

  expect(await call(agent, "list_sources")).toEqual({ isError: false, value: [{ id: lantern, name: "Lantern Stream", lang: "en" }] });
  const found = await call(agent, "search", { query: "lantern" });
  expect(found.value).toEqual([{
    sourceId: lantern, source: "Lantern Stream", hasNextPage: true,
    results: [
      { name: SHOW_TITLE, link: "/show/lantern", imageUrl: "/covers/lantern.jpg", description: "12 episodes · subtitled" },
      { name: "Moth Harbor", link: "/show/other", imageUrl: "/covers/moth.jpg", description: null },
    ],
  }]);
  const show = await call(agent, "show_episodes", { sourceId: lantern, link: "/show/lantern" });
  expect(show.value).toMatchObject({ name: SHOW_TITLE, episodes: [{ number: 1, url: "/watch/1" }, { number: 2, url: "/watch/2" }] });

  const queued = await call(agent, "download", { sourceId: lantern, link: "/show/lantern", showFolder: SHOW_TITLE, episodes: [2] });
  expect(queued.value).toEqual({ added: 1, show: SHOW_TITLE, showFolder: SHOW_TITLE, episodes: [2] });
  await waitUntil("the episode to finish downloading", async () => {
    const listed = await call(agent, "list_downloads");
    return (listed.value as { readonly downloads: readonly unknown[] }).downloads.length === 0 ? true : undefined;
  }, 60_000);
  expect(await readdir(join(target.media, SHOW_TITLE))).toEqual([`${SHOW_TITLE} - 02.mp4`]);
  await target.request("/api/library/refresh", { method: "POST" });
  expect(await call(agent, "list_show_folders")).toEqual({ isError: false, value: [SHOW_TITLE] });
}, 90_000);

test("an episode the show doesn't list is refused with the numbers it does list, and nothing is queued", async () => {
  const { target, lantern } = await withLanternSource();
  const key = await agentKey(target);
  const agent = await connect(target, key);

  const refused = await call(agent, "download", { sourceId: lantern, link: "/show/lantern", showFolder: SHOW_TITLE, episodes: [2, 7] });
  expect(refused).toEqual({ isError: true, value: `Episodes 7 aren't listed for ${SHOW_TITLE}; listed: 1, 2` });
  expect(await call(agent, "list_downloads")).toEqual({ isError: false, value: { downloads: [], torrentError: null } });
}, 60_000);

test("a revoked key stops the agent with Nanime's answer", async () => {
  const { target } = await withLanternSource();
  const key = await agentKey(target);
  const agent = await connect(target, key);
  const listed = await call(agent, "list_sources");
  expect(listed.isError).toBe(false);

  const { keys } = await getJson<{ readonly keys: readonly { readonly id: number }[] }>(target, "/api/agent-keys");
  await target.request(`/api/agent-keys/${String(keys[0]?.id)}`, { method: "DELETE" });
  expect(await call(agent, "list_sources")).toEqual({ isError: true, value: "Nanime answered HTTP 401: Unauthorized" });
}, 60_000);
