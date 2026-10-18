import { realpath } from "node:fs/promises";
import { LibraryFileError, pathSegments, resolveFolder } from "./libraryPaths.ts";
import { canonicalizeTorrentAdditionRoot, forgetTorrentAddition, pendingTorrentPayloads, refreshTorrentAdditions, reserveTorrentAddition, torrentAdditionObserved, torrentOwnershipRead } from "./libraryTorrentClaims.ts";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { TorrentStatus } from "../shared/types.ts";
import { jsonObject } from "./json.ts";
import { searchNyaaResponse } from "./nyaa.ts";

const QBITTORRENT_USERNAME = process.env["QBITTORRENT_USERNAME"] ?? "";
const QBITTORRENT_PASSWORD = process.env["QBITTORRENT_PASSWORD"] ?? "";
const MAX_TORRENT_BYTES = 10 * 1024 * 1024;
const MAX_MAGNET_LENGTH = 16_384;
const OWNERSHIP_TIMEOUT_MS = 5000;
// The client registers a magnet asynchronously, so a just-added torrent can be
// missing from the first listing. Poll briefly before reporting it unobservable.
const ADDITION_OBSERVE_ATTEMPTS = 10;
const ADDITION_OBSERVE_INTERVAL_MS = 500;

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

/**
 * Login responses differ by version: 4.x answers success with 200 "Ok." (and 200 "Fails."
 * on bad credentials); 5.x answers 204 with an empty body and 401 on failure.
 */
export function qBittorrentLoginSucceeded(status: number, body: string): boolean {
  const text = body.trim();
  return (status === 200 && text === "Ok.") || (status === 204 && text === "");
}

async function qBittorrentCookie(signal?: AbortSignal | null): Promise<string | undefined> {
  if (QBITTORRENT_USERNAME === "" || QBITTORRENT_PASSWORD === "") {
    return undefined;
  }
  const body = new URLSearchParams({
    username: QBITTORRENT_USERNAME,
    password: QBITTORRENT_PASSWORD,
  });
  const init: RequestInit = { method: "POST", headers: qBittorrentHeaders(), body };
  if (signal !== undefined) {
    init.signal = signal;
  }
  const response = await fetch(`${QBITTORRENT_URL}/api/v2/auth/login`, init);
  const responseText = await response.text();
  if (!response.ok || !qBittorrentLoginSucceeded(response.status, responseText)) {
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
    const cookie = await qBittorrentCookie(init.signal);
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
  const owned = await Promise.all(payload.map((value) => detachPayload(value)));
  if (owned.some((item) => item === null)) {
    return false;
  }
  const hashes = owned.flatMap((item): readonly string[] => item !== null &&
    files.some((file) => file === item.path || file.startsWith(item.path + sep)) ? [item.hash] : []);
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

async function detachPayload(value: unknown): Promise<{ readonly hash: string; readonly path: string } | null> {
  const item = jsonObject(value);
  if (item === null || typeof item["hash"] !== "string" ||
    typeof item["content_path"] !== "string" || item["content_path"] === "") {
    return null;
  }
  return { hash: item["hash"], path: await canonicalPayloadPath(resolve(item["content_path"])) };
}

export interface TorrentPayload {
  readonly hash: string;
  readonly name: string;
  readonly contentPath: string;
  readonly progress: number;
  readonly state: string;
}

export type TorrentOwnership =
  | { readonly state: "available"; readonly payloads: readonly TorrentPayload[] }
  | { readonly state: "unavailable" }
  | { readonly state: "unconfigured" };

export function torrentPayloadFromJson(value: unknown): TorrentPayload | null {
  const item = jsonObject(value);
  if (
    item === null || typeof item["hash"] !== "string" || typeof item["name"] !== "string" ||
    typeof item["content_path"] !== "string" || item["content_path"] === "" ||
    typeof item["progress"] !== "number" || typeof item["state"] !== "string"
  ) {
    return null;
  }
  return {
    hash: item["hash"],
    name: item["name"],
    contentPath: resolve(item["content_path"]),
    progress: item["progress"],
    state: item["state"],
  };
}

/**
 * Every torrent qBittorrent knows about, complete or not. Ownership is
 * fail-closed: an unreachable client or an entry without a usable content
 * path makes ownership unknown rather than empty.
 */
export async function torrentOwnership(): Promise<TorrentOwnership> {
  if (QBITTORRENT_URL === "") {
    return { state: "unconfigured" };
  }
  const read = torrentOwnershipRead();
  // A stalled client must not stall library writes; treat it as unreachable.
  const response = await qBittorrentRequest("/api/v2/torrents/info", { signal: AbortSignal.timeout(OWNERSHIP_TIMEOUT_MS) });
  const payload: unknown = response?.ok === true ? await response.json().catch(() => null) : null;
  if (!Array.isArray(payload)) {
    return { state: "unavailable" };
  }
  const payloads = payload.flatMap((item) => {
    const parsed = torrentPayloadFromJson(item);
    return parsed === null ? [] : [parsed];
  });
  if (payloads.length !== payload.length) {
    return { state: "unavailable" };
  }
  const canonicalPayloads = await Promise.all(payloads.map((item) => canonicalTorrentPayload(item)));
  refreshTorrentAdditions(canonicalPayloads, payload, read);
  return { state: "available", payloads: [...canonicalPayloads, ...pendingTorrentPayloads()] };
}

async function canonicalTorrentPayload(item: TorrentPayload): Promise<TorrentPayload> {
  return {
    hash: item.hash, name: item.name, progress: item.progress, state: item.state,
    contentPath: await canonicalPayloadPath(item.contentPath),
  };
}

/** Downloading payloads may not exist yet; canonicalize their existing parent. */
async function canonicalPayloadPath(path: string): Promise<string> {
  let current = path;
  const missing: string[] = [];
  while (true) {
    const canonical = await realpath(current).catch(() => null);
    if (canonical !== null) {
      return join(canonical, ...missing.toReversed());
    }
    const parent = dirname(current);
    if (parent === current) {
      return path;
    }
    missing.push(basename(current));
    current = parent;
  }
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

function invalidTorrentInput(torrent: File | null, magnet: string): Response | null {
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
  return null;
}

interface TorrentInput { readonly torrent: File | null; readonly magnet: string }

function torrentRequestBody(input: TorrentInput, savePath: string, tag: string): FormData {
  const { torrent, magnet } = input;
  const body = new FormData();
  if (torrent === null) {
    body.append("urls", magnet);
  } else {
    body.append("torrents", torrent, torrent.name);
  }
  body.append("savepath", savePath);
  body.append("tags", tag);
  return body;
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
  const invalid = invalidTorrentInput(torrent, magnet);
  if (invalid !== null) {
    return invalid;
  }
  if (QBITTORRENT_URL === "") {
    return new Response("Could not reach qBittorrent", { status: 502 });
  }
  return reserveAndAddTorrent({ torrent, magnet }, mediaDir, showFolder);
}

async function reserveAndAddTorrent(input: TorrentInput, mediaDir: string, showFolder: string): Promise<Response> {
  let tag: string | undefined = undefined;
  let savePath = "";
  try {
    if (showFolder !== "") {
      pathSegments(showFolder);
      if (showFolder.includes("/")) {
        return new Response("Choose a show folder", { status: 400 });
      }
    }
    tag = reserveTorrentAddition(mediaDir, showFolder);
    const root = await realpath(mediaDir);
    canonicalizeTorrentAdditionRoot(tag, root);
    savePath = await resolveFolder(root, showFolder === "" ? null : showFolder);
  } catch (error) {
    // Validation failed before POST; there is no external ownership to retain.
    if (tag !== undefined) {
      forgetTorrentAddition(tag);
    }
    if (error instanceof LibraryFileError) {
      return new Response(error.message, { status: error.status === 404 ? 400 : error.status });
    }
    throw error;
  }
  return submitReservedTorrent(input, savePath, tag);
}

async function submitReservedTorrent(input: TorrentInput, savePath: string, tag: string): Promise<Response> {
  const before = await torrentOwnership();
  if (before.state !== "available") {
    // No POST was attempted. An outage alone must not leave a pending root
    // reservation that makes harmless new-folder creation impossible.
    forgetTorrentAddition(tag);
    return new Response("Could not identify qBittorrent ownership", { status: 502 });
  }
  const response = await qBittorrentRequest("/api/v2/torrents/add", {
    method: "POST", body: torrentRequestBody(input, savePath, tag), signal: AbortSignal.timeout(OWNERSHIP_TIMEOUT_MS),
  });
  const detail = await response?.text().catch(() => "") ?? "";
  if (detail.trim() === "Fails.") {
    forgetTorrentAddition(tag);
    return new Response("qBittorrent rejected the torrent", { status: 502 });
  }
  // A lost acknowledgement may still have started a download. Keep its durable
  // scope reservation until tagged payload ownership is actually observed.
  if (response?.ok !== true) {
    return new Response("Torrent addition outcome is unknown; its destination stays locked", { status: 502 });
  }
  return await observeTorrentAddition(tag)
    ? Response.json({ added: true })
    : new Response("Torrent ownership is not observable yet; its destination stays locked", { status: 502 });
}

async function observeTorrentAddition(tag: string): Promise<boolean> {
  for (let attempt = 1; attempt <= ADDITION_OBSERVE_ATTEMPTS; attempt += 1) {
    await torrentOwnership();
    if (torrentAdditionObserved(tag)) {
      return true;
    }
    if (attempt < ADDITION_OBSERVE_ATTEMPTS) {
      await Bun.sleep(ADDITION_OBSERVE_INTERVAL_MS);
    }
  }
  return false;
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
