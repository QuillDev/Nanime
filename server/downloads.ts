import { extname } from "node:path";
import type { DownloadItem, DownloadStatus } from "../shared/types.ts";
import { LibraryFileError, pathSegments } from "./libraryPaths.ts";
import {
  activeDownloadPaths, cancelFileDownload, enqueueFileDownloads, fileDownloadStatuses, pauseFileDownload, resumeFileDownload, startFileDownloads,
  type FileDownloadRequest,
} from "./fileDownloads.ts";
import { noteLibraryMutation, refreshInBackground } from "./mediaLibrary.ts";
import { activeUploadPaths, safeDestinationDirectory } from "./mediaUpload.ts";
import { pauseTorrent, removeTorrent, resumeTorrent, torrentDownloads, torrentHash } from "./torrentDownloads.ts";
import { addMagnet, qBittorrentConfigured, torrentsResponse } from "./torrents.ts";

const MAX_ITEMS = 500;
const MAX_HEADERS = 20;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]{1,100}$/iu;
const UNSAFE_HEADER_VALUE = /[\r\n\0]/u;

interface DownloadsConfiguration {
  readonly mediaDir: string;
  readonly mediaRoot: string;
  readonly videoExtensions: ReadonlySet<string>;
  readonly directPlayExtensions: ReadonlySet<string>;
}

interface AddBody {
  readonly showFolder?: unknown;
  readonly items?: unknown;
}

interface ItemBody {
  readonly kind?: unknown;
  readonly magnet?: unknown;
  readonly url?: unknown;
  readonly fileName?: unknown;
  readonly headers?: unknown;
}

function invalid(message: string): Response {
  return new Response(message, { status: 400 });
}

/** A top-level show folder name, or "" for the library root. */
function showFolderProblem(value: unknown): string | null {
  if (typeof value !== "string") {
    return "Choose a show folder";
  }
  try {
    if (value !== "") {
      pathSegments(value);
    }
  } catch {
    return "Choose a show folder";
  }
  return value.includes("/") ? "Choose a show folder" : null;
}

function validHeaders(value: unknown): value is Readonly<Record<string, string>> {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return entries.length <= MAX_HEADERS && entries.every(([name, header]) => (
    HEADER_NAME.test(name) && typeof header === "string" && header.length <= 4000 && !UNSAFE_HEADER_VALUE.test(header)
  ));
}

function httpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8000) {
    return false;
  }
  const url = URL.parse(value);
  return url !== null && (url.protocol === "http:" || url.protocol === "https:");
}

function safeFileName(value: unknown, extensions: ReadonlySet<string>): value is string {
  return typeof value === "string" && value !== "." && value !== ".." && /^[^/\\\p{Cc}]{1,255}$/u.test(value) &&
    !value.startsWith(".") && extensions.has(extname(value).toLowerCase());
}

function parsedItem(value: unknown, extensions: ReadonlySet<string>): DownloadItem | null {
  const item = value as ItemBody | null;
  if (item?.kind === "torrent" && typeof item.magnet === "string") {
    return { kind: "torrent", magnet: item.magnet };
  }
  if (item?.kind === "file" && httpUrl(item.url) && safeFileName(item.fileName, extensions) && validHeaders(item.headers)) {
    return { kind: "file", url: item.url, fileName: item.fileName, headers: item.headers ?? {} };
  }
  return null;
}

function parsedItems(value: unknown, extensions: ReadonlySet<string>): readonly DownloadItem[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEMS) {
    return null;
  }
  const items = value.map((item) => parsedItem(item, extensions));
  return items.every((item) => item !== null) ? items : null;
}

/** Torrents go to qBittorrent one by one; the first refusal stops the batch. */
async function addEachTorrent(magnets: readonly string[], mediaDir: string, showFolder: string): Promise<Response | null> {
  const [magnet, ...rest] = magnets;
  if (magnet === undefined) {
    return null;
  }
  const response = await addMagnet(magnet, mediaDir, showFolder);
  return response.ok ? await addEachTorrent(rest, mediaDir, showFolder) : response;
}

/** A new show's folder is created first, so its season can download straight into it. */
async function addTorrents(magnets: readonly string[], configuration: DownloadsConfiguration, showFolder: string): Promise<Response | null> {
  if (magnets.length === 0) {
    return null;
  }
  if (showFolder !== "" && await safeDestinationDirectory(configuration.mediaRoot, [showFolder]) === null) {
    return invalid("The show folder can't be used");
  }
  return await addEachTorrent(magnets, configuration.mediaDir, showFolder);
}

async function addFiles(requests: readonly FileDownloadRequest[]): Promise<Response | null> {
  if (requests.length === 0) {
    return null;
  }
  try {
    const queued = await enqueueFileDownloads(requests);
    return queued === "exists" ? new Response("A file with that name already exists", { status: 409 }) : null;
  } catch (error) {
    if (error instanceof LibraryFileError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  }
}

async function addResponse(req: Request, configuration: DownloadsConfiguration): Promise<Response> {
  const body = (await req.json().catch(() => null)) as AddBody | null;
  const folderProblem = showFolderProblem(body?.showFolder);
  const items = parsedItems(body?.items, configuration.videoExtensions);
  if (folderProblem !== null || items === null) {
    return invalid(folderProblem ?? "Choose up to 500 torrents or video links");
  }
  const showFolder = body?.showFolder as string;
  const files = items.flatMap((item) => (item.kind === "file" ? [{ ...item, showFolder, headers: item.headers ?? {} }] : []));
  if (files.length > 0 && showFolder === "") {
    return invalid("Choose a show folder for direct downloads");
  }
  const magnets = items.flatMap((item) => (item.kind === "torrent" ? [item.magnet] : []));
  const failed = await addFiles(files) ?? await addTorrents(magnets, configuration, showFolder);
  return failed ?? Response.json({ added: items.length });
}

async function listResponse(mediaDir: string): Promise<Response> {
  const torrents = await torrentDownloads(mediaDir, qBittorrentConfigured);
  const downloads: readonly DownloadStatus[] = [
    ...(torrents.ok ? torrents.downloads : []),
    ...fileDownloadStatuses(),
  ].toSorted((a, b) => b.addedOn - a.addedOn);
  return Response.json({ downloads, torrentError: torrents.ok ? null : torrents.error });
}

interface CancelBody {
  readonly deleteFiles?: unknown;
}

async function cancel(req: Request, id: string): Promise<boolean | null> {
  const body = (await req.json().catch(() => null)) as CancelBody | null;
  if (typeof body?.deleteFiles !== "boolean") {
    return null;
  }
  const hash = torrentHash(id);
  return hash === null ? await cancelFileDownload(id) : await removeTorrent(hash, body.deleteFiles);
}

async function control(req: Request, id: string, action: string): Promise<boolean | null> {
  const hash = torrentHash(id);
  if (action === "pause") {
    return hash === null ? pauseFileDownload(id) : await pauseTorrent(hash);
  }
  if (action === "resume") {
    return hash === null ? resumeFileDownload(id) : await resumeTorrent(hash);
  }
  return action === "cancel" ? await cancel(req, id) : null;
}

async function controlResponse(req: Request, id: string, action: string): Promise<Response> {
  const result = await control(req, id, action);
  if (result === null) {
    return invalid("Invalid download request");
  }
  if (!result) {
    return torrentHash(id) === null ? new Response("Download not found", { status: 404 }) : new Response("qBittorrent rejected the request", { status: 502 });
  }
  return Response.json({ ok: true });
}

/** Library paths that uploads and direct downloads are still writing. */
export function activeTransferPaths(): readonly string[] {
  return [...activeUploadPaths(), ...activeDownloadPaths()];
}

function downloadsResponse(req: Request, pathname: string, configuration: DownloadsConfiguration): Promise<Response> {
  if (pathname === "/api/downloads") {
    return req.method === "GET" ? listResponse(configuration.mediaDir) : addResponse(req, configuration);
  }
  const match = /^\/api\/downloads\/(?<id>[^/]+)\/(?<action>pause|resume|cancel)$/u.exec(pathname)?.groups;
  if (match === undefined || req.method !== "POST") {
    return Promise.resolve(new Response("Not found", { status: 404 }));
  }
  return controlResponse(req, decodeURIComponent(match["id"] ?? ""), match["action"] ?? "");
}

function under(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export interface DownloadRoutes {
  /** Resumes unfinished direct downloads; call after library recovery. */
  readonly start: () => void;
  readonly handles: (pathname: string) => boolean;
  readonly respond: (req: Request, url: URL) => Promise<Response>;
}

/**
 * `/api/downloads` (list, add, and pause/resume/cancel per id) plus the torrent
 * file upload and Nyaa search under `/api/torrents`. Admin-only, checked by the
 * caller.
 */
export function downloadRoutes(configuration: DownloadsConfiguration): DownloadRoutes {
  const { mediaDir, videoExtensions, directPlayExtensions } = configuration;
  const start = (): void => startFileDownloads({
    mediaRoot: configuration.mediaRoot,
    onComplete: () => {
      noteLibraryMutation();
      void refreshInBackground({ mediaDir, videoExtensions, directPlayExtensions });
    },
  });
  return {
    start,
    handles: (pathname) => under(pathname, "/api/downloads") || under(pathname, "/api/torrents"),
    respond: (req, url) => (under(url.pathname, "/api/downloads")
      ? downloadsResponse(req, url.pathname, configuration)
      : torrentsResponse(req, mediaDir, url)),
  };
}
