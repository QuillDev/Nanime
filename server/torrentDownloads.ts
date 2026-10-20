import { relative, resolve, sep } from "node:path";
import type { DownloadState, DownloadStatus } from "../shared/types.ts";
import { jsonObject, type JsonObject } from "./json.ts";
import { qBittorrentRequest } from "./torrents.ts";

/** The per-torrent states qBittorrent reports, folded into the few every download shares. */
const STATES = new Map<string, DownloadState>(Object.entries({
  downloading: "downloading",
  forcedDL: "downloading",
  metaDL: "downloading",
  forcedMetaDL: "downloading",
  stalledDL: "stalled",
  pausedDL: "paused",
  stoppedDL: "paused",
  queuedDL: "queued",
  checkingDL: "queued",
  checkingResumeData: "queued",
  allocating: "queued",
  moving: "queued",
  error: "failed",
  missingFiles: "failed",
} as const));

const HASH = /^[a-f0-9]{40,64}$/iu;
const PREFIX = "torrent:";

/** The torrent hash behind a download id, or null for direct downloads. */
export function torrentHash(id: string): string | null {
  const hash = id.startsWith(PREFIX) ? id.slice(PREFIX.length) : "";
  return HASH.test(hash) ? hash : null;
}

function showFolder(mediaDir: string, contentPath: string): string | null {
  const root = resolve(mediaDir);
  const content = resolve(contentPath);
  if (content === root || !content.startsWith(root + sep)) {
    return null;
  }
  return relative(root, content).split(sep)[0] ?? null;
}

function validTorrent(item: JsonObject | null): item is JsonObject & Readonly<Record<"hash" | "name" | "content_path" | "state", string>> & Readonly<Record<"progress" | "dlspeed" | "eta" | "completed" | "size" | "added_on", number>> {
  return item !== null &&
    ["hash", "name", "content_path", "state"].every((key) => typeof item[key] === "string") &&
    ["progress", "dlspeed", "eta", "completed", "size", "added_on"].every((key) => typeof item[key] === "number");
}

function torrentStatus(value: unknown, mediaDir: string): DownloadStatus | null {
  const item = jsonObject(value);
  if (!validTorrent(item)) {
    return null;
  }
  const state = STATES.get(item.state) ?? "queued";
  return {
    id: `${PREFIX}${item.hash}`,
    kind: "torrent",
    name: item.name,
    showFolder: showFolder(mediaDir, item.content_path),
    state,
    progress: item.progress,
    downloadSpeed: item.dlspeed,
    eta: item.eta > 0 && item.eta < 8_640_000 ? item.eta : 0,
    completed: item.completed,
    size: item.size,
    addedOn: item.added_on,
    error: state === "failed" ? "qBittorrent reports an error for this torrent" : null,
  };
}

export type TorrentList =
  | { readonly ok: true; readonly downloads: readonly DownloadStatus[] }
  | { readonly ok: false; readonly error: string };

/** Unfinished torrents; an unconfigured client simply has none. */
export async function torrentDownloads(mediaDir: string, configured: boolean): Promise<TorrentList> {
  if (!configured) {
    return { ok: true, downloads: [] };
  }
  const response = await qBittorrentRequest("/api/v2/torrents/info?sort=added_on&reverse=true&limit=50");
  if (response?.ok !== true) {
    return { ok: false, error: "Could not reach qBittorrent" };
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!Array.isArray(payload)) {
    return { ok: false, error: "qBittorrent returned an invalid torrent list" };
  }
  const downloads = payload.flatMap((item) => {
    const status = torrentStatus(item, mediaDir);
    return status === null || status.progress >= 1 ? [] : [status];
  });
  return { ok: true, downloads };
}

async function post(path: string, fields: Readonly<Record<string, string>>): Promise<Response | null> {
  return await qBittorrentRequest(path, { method: "POST", body: new URLSearchParams(fields) });
}

/** Version 5 of qBittorrent renamed pause/resume to stop/start; try the new name, then the old one. */
async function toggle(hash: string, names: readonly [string, string]): Promise<boolean> {
  const [current, legacy] = names;
  const response = await post(`/api/v2/torrents/${current}`, { hashes: hash });
  if (response?.status === 404) {
    const fallback = await post(`/api/v2/torrents/${legacy}`, { hashes: hash });
    return fallback?.ok === true;
  }
  return response?.ok === true;
}

export function pauseTorrent(hash: string): Promise<boolean> {
  return toggle(hash, ["stop", "pause"]);
}

export function resumeTorrent(hash: string): Promise<boolean> {
  return toggle(hash, ["start", "resume"]);
}

export async function removeTorrent(hash: string, deleteFiles: boolean): Promise<boolean> {
  const response = await post("/api/v2/torrents/delete", { hashes: hash, deleteFiles: String(deleteFiles) });
  return response?.ok === true;
}
