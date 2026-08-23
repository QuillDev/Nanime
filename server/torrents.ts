import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { TorrentStatus } from "../shared/types.ts";
import { jsonObject } from "./json.ts";
import { searchNyaaResponse } from "./nyaa.ts";

const QBITTORRENT_USERNAME = process.env["QBITTORRENT_USERNAME"] ?? "";
const QBITTORRENT_PASSWORD = process.env["QBITTORRENT_PASSWORD"] ?? "";
const MAX_TORRENT_BYTES = 10 * 1024 * 1024;
const MAX_MAGNET_LENGTH = 16_384;

function configuredQbittorrentUrl(value: string): string {
  if (value === "") {
    return "";
  }
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("QBITTORRENT_URL must be an HTTP(S) origin without credentials or a path");
  }
  return url.origin;
}

const QBITTORRENT_URL = configuredQbittorrentUrl(process.env["QBITTORRENT_URL"] ?? "");
if ((QBITTORRENT_USERNAME === "") !== (QBITTORRENT_PASSWORD === "")) {
  throw new Error("Set both QBITTORRENT_USERNAME and QBITTORRENT_PASSWORD, or neither");
}

function qBittorrentHeaders(cookie?: string): Headers {
  const headers = new Headers({
    origin: QBITTORRENT_URL,
    referer: `${QBITTORRENT_URL}/`,
  });
  if (cookie !== undefined) {
    headers.set("cookie", cookie);
  }
  return headers;
}

async function qBittorrentCookie(): Promise<string | undefined> {
  if (QBITTORRENT_USERNAME === "" || QBITTORRENT_PASSWORD === "") {
    return undefined;
  }
  const body = new URLSearchParams({
    username: QBITTORRENT_USERNAME,
    password: QBITTORRENT_PASSWORD,
  });
  const response = await fetch(`${QBITTORRENT_URL}/api/v2/auth/login`, {
    method: "POST",
    headers: qBittorrentHeaders(),
    body,
  });
  const responseText = await response.text();
  if (!response.ok || responseText.trim() !== "Ok.") {
    throw new Error("qBittorrent authentication failed");
  }
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (cookie === undefined || cookie === "") {
    throw new Error("qBittorrent did not return a session");
  }
  return cookie;
}

async function qBittorrentRequest(
  path: string,
  init: Omit<RequestInit, "headers"> = {},
): Promise<Response | null> {
  if (QBITTORRENT_URL === "") {
    return null;
  }
  try {
    const cookie = await qBittorrentCookie();
    return await fetch(`${QBITTORRENT_URL}${path}`, {
      ...init,
      headers: qBittorrentHeaders(cookie),
    });
  } catch {
    return null;
  }
}

export async function detachTorrentsForFiles(files: readonly string[]): Promise<boolean> {
  const listResponse = await qBittorrentRequest("/api/v2/torrents/info");
  if (listResponse === null || !listResponse.ok) {
    return false;
  }
  const payload: unknown = await listResponse.json().catch(() => null);
  if (!Array.isArray(payload)) {
    return false;
  }
  const hashes = payload.flatMap((value): readonly string[] => {
    const item = jsonObject(value);
    if (item === null) {
      return [];
    }
    if (typeof item["hash"] !== "string" || typeof item["content_path"] !== "string") {
      return [];
    }
    const contentPath = resolve(item["content_path"]);
    return files.some((file) => file === contentPath || file.startsWith(contentPath + sep))
      ? [item["hash"]]
      : [];
  });
  if (hashes.length === 0) {
    return true;
  }
  const body = new URLSearchParams({
    hashes: hashes.join("|"),
    deleteFiles: "false",
  });
  const deleteResponse = await qBittorrentRequest("/api/v2/torrents/delete", {
    method: "POST",
    body,
  });
  return deleteResponse?.ok === true;
}

async function existingShowFolder(mediaDir: string, name: string): Promise<string | null> {
  if (name === "") {
    return mediaDir;
  }
  const folders = await readdir(mediaDir, { withFileTypes: true });
  return folders.some((entry) => entry.isDirectory() && entry.name === name)
    ? join(mediaDir, name)
    : null;
}

function validMagnetLink(value: string): boolean {
  if (value.length > MAX_MAGNET_LENGTH) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "magnet:" && url.searchParams.getAll("xt").some((topic) => {
      const normalized = topic.toLowerCase();
      return normalized.startsWith("urn:btih:") || normalized.startsWith("urn:btmh:");
    });
  } catch {
    return false;
  }
}

function torrentShowFolder(mediaDir: string, contentPath: string): string | null {
  const root = resolve(mediaDir);
  const content = resolve(contentPath);
  if (content === root || !content.startsWith(root + sep)) {
    return null;
  }
  return relative(root, content).split(sep)[0] ?? null;
}

function torrentStatus(value: unknown, mediaDir: string): TorrentStatus | null {
  const item = jsonObject(value);
  if (item === null) {
    return null;
  }
  const valid = typeof item["hash"] === "string" &&
    typeof item["name"] === "string" &&
    typeof item["content_path"] === "string" &&
    typeof item["progress"] === "number" &&
    typeof item["dlspeed"] === "number" &&
    typeof item["eta"] === "number" &&
    typeof item["completed"] === "number" &&
    typeof item["size"] === "number" &&
    typeof item["state"] === "string" &&
    typeof item["added_on"] === "number";
  if (!valid) {
    return null;
  }
  return {
    hash: item["hash"] as string,
    name: item["name"] as string,
    showFolder: torrentShowFolder(mediaDir, item["content_path"] as string),
    progress: item["progress"] as number,
    downloadSpeed: item["dlspeed"] as number,
    eta: item["eta"] as number,
    completed: item["completed"] as number,
    size: item["size"] as number,
    state: item["state"] as string,
    addedOn: item["added_on"] as number,
  };
}

async function torrentListResponse(mediaDir: string): Promise<Response> {
  const response = await qBittorrentRequest(
    "/api/v2/torrents/info?sort=added_on&reverse=true&limit=50",
  );
  if (response === null) {
    return new Response("Could not reach qBittorrent", { status: 502 });
  }
  if (!response.ok) {
    return new Response((await response.text()) || "qBittorrent rejected the request", {
      status: 502,
    });
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!Array.isArray(payload)) {
    return new Response("qBittorrent returned an invalid torrent list", { status: 502 });
  }
  const torrents = payload.map((item) => torrentStatus(item, mediaDir)).filter(
    (item): item is TorrentStatus => item !== null,
  );
  const incomplete = torrents.filter((item) => item.progress < 1);
  return Response.json(incomplete);
}

async function addTorrentResponse(req: Request, mediaDir: string): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const form = await req.formData().catch(() => null);
  const torrentValue = form?.get("torrent");
  const torrent = torrentValue instanceof File ? torrentValue : null;
  const magnetValue = form?.get("magnet");
  const magnet = typeof magnetValue === "string" ? magnetValue.trim() : "";
  const showFolderValue = form?.get("showFolder");
  const showFolder = typeof showFolderValue === "string" ? showFolderValue : "";
  if ((torrent === null) === (magnet === "")) {
    return new Response("Choose one .torrent file or magnet link", { status: 400 });
  }
  if (torrent !== null && !torrent.name.toLowerCase().endsWith(".torrent")) {
    return new Response("Choose a .torrent file", { status: 400 });
  }
  if (torrent !== null && (torrent.size === 0 || torrent.size > MAX_TORRENT_BYTES)) {
    return new Response("Torrent files must be between 1 byte and 10 MB", { status: 400 });
  }
  if (magnet !== "" && !validMagnetLink(magnet)) {
    return new Response("Enter a valid BitTorrent magnet link", { status: 400 });
  }
  const savePath = await existingShowFolder(mediaDir, showFolder);
  if (savePath === null) {
    return new Response("The selected show folder no longer exists", { status: 400 });
  }

  const body = new FormData();
  if (torrent === null) {
    body.append("urls", magnet);
  } else {
    body.append("torrents", torrent, torrent.name);
  }
  body.append("savepath", savePath);
  const response = await qBittorrentRequest("/api/v2/torrents/add", {
    method: "POST",
    body,
  });
  if (response === null) {
    return new Response("Could not reach qBittorrent", { status: 502 });
  }
  const detail = await response.text();
  if (!response.ok || detail.trim() === "Fails.") {
    return new Response(detail.trim() || "qBittorrent rejected the torrent", { status: 502 });
  }
  return Response.json({ added: true });
}

interface CancelTorrentBody {
  readonly deleteFiles?: unknown;
}

async function cancelTorrentResponse(req: Request, hash: string): Promise<Response> {
  if (req.method !== "POST" || !/^[a-f0-9]{40,64}$/iu.test(hash)) {
    return new Response("Invalid torrent cancellation request", { status: 400 });
  }
  const requestBody = (await req.json().catch(() => null)) as CancelTorrentBody | null;
  if (typeof requestBody?.deleteFiles !== "boolean") {
    return new Response("Choose whether downloaded files should be removed", { status: 400 });
  }
  const body = new URLSearchParams({
    hashes: hash,
    deleteFiles: String(requestBody.deleteFiles),
  });
  const response = await qBittorrentRequest("/api/v2/torrents/delete", {
    method: "POST",
    body,
  });
  if (response === null) {
    return new Response("Could not reach qBittorrent", { status: 502 });
  }
  if (!response.ok) {
    return new Response((await response.text()) || "qBittorrent rejected the request", {
      status: 502,
    });
  }
  return Response.json({ cancelled: true });
}

export function torrentsResponse(req: Request, mediaDir: string, url: URL): Promise<Response> {
  if (url.pathname === "/api/torrents/search") {
    return req.method === "GET"
      ? searchNyaaResponse(url)
      : Promise.resolve(new Response("Method not allowed", { status: 405 }));
  }
  const cancelHash = /^\/api\/torrents\/(?<hash>[a-f0-9]+)\/cancel$/iu.exec(url.pathname)
    ?.groups?.["hash"];
  if (cancelHash !== undefined) {
    return cancelTorrentResponse(req, cancelHash);
  }
  return req.method === "GET" ? torrentListResponse(mediaDir) : addTorrentResponse(req, mediaDir);
}
