import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { DownloadStatus } from "../shared/types.ts";
import type { NanimeClient } from "./mcpClient.ts";

interface EdenAnswer<T> {
  readonly data: T | null;
  readonly error: { readonly value: unknown } | null;
  readonly status: number;
}

/** Nanime's answer, or an error carrying the message the route sent back. */
function unwrap<T>(answer: EdenAnswer<T>): T {
  if (answer.error !== null || answer.data === null) {
    const message = typeof answer.error?.value === "string" ? answer.error.value : "No answer";
    throw new Error(`Nanime answered HTTP ${String(answer.status)}: ${message}`);
  }
  return answer.data;
}

function reply(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** Tool failures go back to the model as text it can act on, not as protocol errors. */
async function answered<T>(work: () => Promise<T>): Promise<CallToolResult> {
  try {
    return reply(await work());
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
}

async function installedSources(client: NanimeClient) {
  const { sources } = unwrap(await client.api.sources.get({ query: {} }));
  return sources.map(({ id, name, lang }) => ({ id, name, lang }));
}

interface SearchRequest {
  readonly query: string;
  readonly sourceId?: string | undefined;
  readonly page?: number | undefined;
}

async function searchSource(client: NanimeClient, source: { readonly id: string; readonly name: string }, request: SearchRequest) {
  const page = String(request.page ?? 1);
  try {
    const found = unwrap(await client.api.sources.search.get({ query: { id: source.id, q: request.query, page } }));
    return { sourceId: source.id, source: source.name, results: found.results, hasNextPage: found.hasNextPage };
  } catch (error) {
    return { sourceId: source.id, source: source.name, error: error instanceof Error ? error.message : String(error) };
  }
}

/** One source when asked for, otherwise every installed source at once. */
async function search(client: NanimeClient, request: SearchRequest) {
  const sources = await installedSources(client);
  const chosen = request.sourceId === undefined ? sources : sources.filter((source) => source.id === request.sourceId);
  if (chosen.length === 0) {
    throw new Error(request.sourceId === undefined ? "No sources are installed" : "That source isn't installed");
  }
  return await Promise.all(chosen.map((source) => searchSource(client, source, request)));
}

async function showFolders(client: NanimeClient) {
  const entries = unwrap(await client.api.list.get());
  const folders = new Set(entries.flatMap((entry) => entry.folder.split("/").filter((part) => part !== "").slice(0, 1)));
  return [...folders].toSorted((a, b) => a.localeCompare(b));
}

interface DownloadRequest {
  readonly sourceId: string;
  readonly link: string;
  readonly showFolder: string;
  readonly episodes?: readonly number[] | undefined;
}

/** Lists the show's episodes again and queues the chosen numbers (all of them when none are named). */
async function download(client: NanimeClient, request: DownloadRequest) {
  const show = unwrap(await client.api.sources.detail.get({ query: { id: request.sourceId, url: request.link } }));
  const wanted = request.episodes === undefined ? null : new Set(request.episodes);
  const chosen = show.episodes.filter((episode) => wanted?.has(episode.number) ?? true);
  const missing = [...wanted ?? []].filter((number) => !chosen.some((episode) => episode.number === number));
  if (chosen.length === 0 || missing.length > 0) {
    const listed = show.episodes.map((episode) => episode.number).join(", ") || "none";
    throw new Error(`Episodes ${missing.join(", ") || "requested"} aren't listed for ${show.name}; listed: ${listed}`);
  }
  const episodes = chosen.map(({ url, number }) => ({ url, number }));
  const { added } = unwrap(await client.api.sources.download.post({ id: request.sourceId, showFolder: request.showFolder, episodes }));
  return { added, show: show.name, showFolder: request.showFolder, episodes: chosen.map((episode) => episode.number) };
}

function downloadView(status: DownloadStatus) {
  const { id, kind, name, showFolder, state, size, eta, error } = status;
  return { id, kind, name, showFolder, state, percent: Math.round(status.progress * 1000) / 10, size, etaSeconds: eta, error };
}

async function downloads(client: NanimeClient) {
  const listed = unwrap(await client.api.downloads.get());
  return { downloads: listed.downloads.map((entry) => downloadView(entry)), torrentError: listed.torrentError };
}

interface ControlRequest {
  readonly id: string;
  readonly action: "pause" | "resume" | "cancel";
  readonly deleteFiles?: boolean | undefined;
}

async function control(client: NanimeClient, request: ControlRequest) {
  const target = client.api.downloads({ id: request.id });
  if (request.action === "cancel") {
    return unwrap(await target.cancel.post({ deleteFiles: request.deleteFiles ?? false }));
  }
  return unwrap(await (request.action === "pause" ? target.pause.post() : target.resume.post()));
}

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

function registerLookups(server: McpServer, client: NanimeClient): void {
  server.registerTool("list_sources", {
    description: "Source plugins installed in Nanime (e.g. Nyaa). Their ids go into search and download.",
    annotations: readOnly,
  }, () => answered(() => installedSources(client)));
  server.registerTool("search", {
    description: "Search Nanime's installed source plugins for a show or release. Searches every installed source unless sourceId is given. Each result's link goes to show_episodes or download.",
    inputSchema: { query: z.string().min(1).max(200), sourceId: z.string().optional(), page: z.number().int().min(1).max(1000).optional() },
    annotations: readOnly,
  }, (request) => answered(() => search(client, request)));
  server.registerTool("show_episodes", {
    description: "A search result's details and numbered episodes. A torrent result (Nyaa) has one episode: the whole release.",
    inputSchema: { sourceId: z.string(), link: z.string().min(1) },
    annotations: readOnly,
  }, ({ sourceId, link }) => answered(async () => unwrap(await client.api.sources.detail.get({ query: { id: sourceId, url: link } }))));
  server.registerTool("list_show_folders", {
    description: "Top-level show folders already in the library. Reuse one for a show Nanime already has; a new name creates a folder.",
    annotations: readOnly,
  }, () => answered(() => showFolders(client)));
  server.registerTool("list_downloads", {
    description: "Nanime's downloads (torrents in qBittorrent and direct downloads) with state, percent done and errors.",
    annotations: readOnly,
  }, () => answered(() => downloads(client)));
}

function registerActions(server: McpServer, client: NanimeClient): void {
  server.registerTool("download", {
    description: "Queue a search result's episodes into a show folder through Nanime's downloads. Omit episodes to queue every listed episode (a Nyaa torrent is one).",
    inputSchema: {
      sourceId: z.string(), link: z.string().min(1), showFolder: z.string().min(1).max(200),
      episodes: z.array(z.number().min(0)).min(1).max(500).optional(),
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  }, (request) => answered(() => download(client, request)));
  server.registerTool("control_download", {
    description: "Pause, resume or cancel a download by its id from list_downloads. Cancel keeps downloaded files unless deleteFiles is true.",
    inputSchema: { id: z.string().min(1), action: z.enum(["pause", "resume", "cancel"]), deleteFiles: z.boolean().optional() },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, (request) => answered(() => control(client, request)));
}

/** Search, episode listing and downloads; repositories and installs stay with the admin in the web app. */
export function registerNanimeTools(server: McpServer, client: NanimeClient): void {
  registerLookups(server, client);
  registerActions(server, client);
}
