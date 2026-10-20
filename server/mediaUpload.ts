import { randomUUID } from "node:crypto";
import { lstat, link, mkdir, open, realpath, unlink } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileSystemErrorCode } from "./fileSystemError.ts";
import { recordUploadActivity } from "./libraryActivity.ts";
import { claimLibraryPaths, libraryPathUnavailable } from "./libraryWriters.ts";
import { LibraryFileError } from "./libraryPaths.ts";

const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024 * 1024;
const MAX_ACTIVE_UPLOADS = 128;
const UPLOAD_LIFETIME_MS = 24 * 60 * 60 * 1000;

interface UploadSession {
  readonly id: string;
  readonly userId: number;
  readonly temporaryPath: string;
  readonly destinationPath: string;
  readonly relativePath: string;
  readonly size: number;
  readonly expiresAt: number;
  readonly release: () => void;
  received: number;
  activeWrites: number;
  discarded: boolean;
  expiration: ReturnType<typeof setTimeout> | null;
}

interface UploadStartBody {
  readonly fileName?: unknown;
  readonly folder?: unknown;
  readonly size?: unknown;
}

interface ValidUploadStart {
  readonly fileName: string;
  readonly parts: readonly string[];
  readonly size: number;
}

interface MediaUploadOptions {
  readonly mediaRoot: string;
  readonly videoExtensions: ReadonlySet<string>;
  readonly userId: number;
  readonly username: string;
}

const uploads = new Map<string, UploadSession>();
// Destinations claimed by uploads that are still being set up.
const reservedDestinations = new Set<string>();

/** Library-relative destinations of uploads that are being set up or still receiving chunks. */
export function activeUploadPaths(): readonly string[] {
  const now = Date.now();
  return [
    ...reservedDestinations,
    ...[...uploads.values()].flatMap((session) => (session.expiresAt > now ? [session.relativePath] : [])),
  ];
}

function safePart(value: string): boolean {
  return value !== "." && value !== ".." && /^[^/\\\p{Cc}]{1,255}$/u.test(value);
}

function folderParts(value: string): readonly string[] | null {
  if (value === "") {
    return [];
  }
  if (value.length > 1000 || value.startsWith("/") || value.includes("\\")) {
    return null;
  }
  const parts = value.split("/");
  return parts.every((part) => safePart(part)) ? parts : null;
}

export async function safeDestinationDirectory(
  mediaRoot: string,
  parts: readonly string[],
): Promise<string | null> {
  const canonicalRoot = await realpath(mediaRoot).catch(() => null);
  if (canonicalRoot === null) {
    return null;
  }
  let current = canonicalRoot;
  for (const part of parts) {
    const candidate = join(current, part);
    const existing = await lstat(candidate).catch(() => null);
    if (existing === null) {
      await mkdir(candidate).catch(() => undefined);
    }
    const created = await lstat(candidate).catch(() => null);
    if (created?.isDirectory() !== true || created.isSymbolicLink()) {
      return null;
    }
    const canonical = await realpath(candidate).catch(() => null);
    if (
      canonical === null ||
      canonical !== canonicalRoot && !canonical.startsWith(canonicalRoot + sep)
    ) {
      return null;
    }
    current = canonical;
  }
  return current;
}

async function discard(session: UploadSession): Promise<void> {
  session.discarded = true;
  if (session.expiration !== null) {
    clearTimeout(session.expiration);
    session.expiration = null;
  }
  uploads.delete(session.id);
  await unlink(session.temporaryPath).catch(() => undefined);
  if (session.activeWrites === 0) {
    session.release();
  }
}

async function removeExpiredUploads(): Promise<void> {
  const now = Date.now();
  await Promise.all([...uploads.values()].flatMap((session) => (
    session.expiresAt <= now ? [discard(session)] : []
  )));
}

function uploadStart(
  body: UploadStartBody | null,
  videoExtensions: ReadonlySet<string>,
): ValidUploadStart | null {
  const fileName = body?.fileName;
  const folder = body?.folder;
  const size = body?.size;
  const parts = typeof folder === "string" ? folderParts(folder.trim()) : null;
  if (typeof fileName !== "string" || !safePart(fileName) || parts === null ||
    typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 ||
    size > MAX_UPLOAD_BYTES || !videoExtensions.has(extname(fileName).toLowerCase())) {
    return null;
  }
  return { fileName, parts, size };
}

function destinationPath(directory: string, fileName: string): string | null {
  const path = resolve(directory, fileName);
  return path === directory || !path.startsWith(directory + sep) ? null : path;
}

async function startUpload(
  req: Request,
  options: MediaUploadOptions,
): Promise<Response> {
  await removeExpiredUploads();
  if (uploads.size >= MAX_ACTIVE_UPLOADS) {
    return new Response("Too many uploads are active", { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as UploadStartBody | null;
  const upload = uploadStart(body, options.videoExtensions);
  if (upload === null) {
    return new Response("Choose a supported video file and destination", { status: 400 });
  }
  // Claimed synchronously, so a library file operation either sees this
  // upload's lock or is already visible here as busy.
  const relativePath = [...upload.parts, upload.fileName].join("/");
  const unavailable = libraryPathUnavailable(relativePath);
  if (unavailable !== null) {
    return new Response(unavailable, { status: 423 });
  }
  let release: (() => void) | undefined = undefined;
  let admitted = false;
  try {
    release = claimLibraryPaths([relativePath], true);
    reservedDestinations.add(relativePath);
    const result = await createUploadSession(upload, { relativePath, release }, options);
    admitted = result.ok;
    return result;
  } catch (error) {
    if (error instanceof LibraryFileError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  } finally {
    reservedDestinations.delete(relativePath);
    if (!admitted) {
      release?.();
    }
  }
}

async function createUploadSession(
  upload: ValidUploadStart,
  reservation: { readonly relativePath: string; readonly release: () => void },
  options: MediaUploadOptions,
): Promise<Response> {
  const { relativePath, release } = reservation;
  const destinationDirectory = await safeDestinationDirectory(options.mediaRoot, upload.parts);
  if (destinationDirectory === null) {
    return new Response("Invalid upload destination", { status: 400 });
  }
  const resolvedDestination = destinationPath(destinationDirectory, upload.fileName);
  if (resolvedDestination === null) {
    return new Response("Invalid upload destination", { status: 400 });
  }
  if (await lstat(resolvedDestination).catch(() => null) !== null) {
    return new Response("A file with that name already exists", { status: 409 });
  }
  const temporaryDirectory = await safeDestinationDirectory(options.mediaRoot, [".nanime-uploads"]);
  if (temporaryDirectory === null) {
    return new Response("Upload storage is unavailable", { status: 503 });
  }
  const id = randomUUID();
  const temporaryPath = join(temporaryDirectory, `${id}.part`);
  const file = await open(temporaryPath, "wx", 0o600).catch(() => null);
  if (file === null) {
    return new Response("Could not prepare upload", { status: 500 });
  }
  await file.close();
  const session: UploadSession = {
    id,
    userId: options.userId,
    temporaryPath,
    destinationPath: resolvedDestination,
    relativePath,
    size: upload.size,
    received: 0,
    activeWrites: 0,
    discarded: false,
    expiration: null,
    expiresAt: Date.now() + UPLOAD_LIFETIME_MS,
    release,
  };
  uploads.set(id, session);
  session.expiration = setTimeout(() => { void discard(session); }, UPLOAD_LIFETIME_MS);
  session.expiration.unref();
  return Response.json({ id, chunkSize: MAX_CHUNK_BYTES });
}

function ownedUpload(id: string, userId: number): UploadSession | null {
  const session = uploads.get(id);
  return session?.userId === userId ? session : null;
}

async function appendChunk(req: Request, id: string, userId: number): Promise<Response> {
  await removeExpiredUploads();
  const session = ownedUpload(id, userId);
  if (session === null) {
    return new Response("Upload not found", { status: 404 });
  }
  return withUploadWrite(session, () => appendClaimedChunk(req, session));
}

async function withUploadWrite(session: UploadSession, work: () => Promise<Response>): Promise<Response> {
  session.activeWrites += 1;
  try {
    return await work();
  } finally {
    session.activeWrites -= 1;
    if (session.discarded && session.activeWrites === 0) {
      session.release();
    }
  }
}

async function appendClaimedChunk(req: Request, session: UploadSession): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const chunk = form?.get("chunk");
  const offsetValue = form?.get("offset");
  const offset = typeof offsetValue === "string" ? Number(offsetValue) : Number.NaN;
  if (
    !(chunk instanceof File) || chunk.size <= 0 || chunk.size > MAX_CHUNK_BYTES ||
    !Number.isSafeInteger(offset) || offset !== session.received ||
    session.received + chunk.size > session.size
  ) {
    return new Response("Invalid upload chunk", { status: 400 });
  }
  const bytes = new Uint8Array(await chunk.arrayBuffer());
  const file = await open(session.temporaryPath, "r+").catch(() => null);
  if (file === null) {
    await discard(session);
    return new Response("Upload is no longer available", { status: 410 });
  }
  try {
    const result = await file.write(bytes, 0, bytes.byteLength, session.received);
    if (result.bytesWritten !== bytes.byteLength) {
      return new Response("Could not write upload chunk", { status: 500 });
    }
    session.received += result.bytesWritten;
  } finally {
    await file.close();
  }
  return Response.json({ received: session.received });
}

async function completeUpload(id: string, options: MediaUploadOptions): Promise<Response> {
  await removeExpiredUploads();
  const session = ownedUpload(id, options.userId);
  if (session === null) {
    return new Response("Upload not found", { status: 404 });
  }
  return withUploadWrite(session, () => completeClaimedUpload(session, options));
}

async function completeClaimedUpload(session: UploadSession, options: MediaUploadOptions): Promise<Response> {
  if (session.received !== session.size) {
    return new Response("Upload is incomplete", { status: 409 });
  }
  const temporary = await lstat(session.temporaryPath).catch(() => null);
  if (temporary?.isFile() !== true || temporary.size !== session.size) {
    await discard(session);
    return new Response("Uploaded file is invalid", { status: 400 });
  }
  try {
    await link(session.temporaryPath, session.destinationPath);
  } catch (error) {
    const code = fileSystemErrorCode(error);
    return new Response(
      code === "EEXIST" ? "A file with that name already exists" : "Could not finish upload",
      { status: code === "EEXIST" ? 409 : 500 },
    );
  }
  try {
    recordUploadActivity(
      { id: options.userId, username: options.username },
      session.relativePath,
      session.size,
    );
  } catch {
    await unlink(session.destinationPath).catch(() => undefined);
    return new Response("Could not record completed upload", { status: 500 });
  }
  await discard(session);
  return Response.json({ path: session.relativePath });
}

async function cancelUpload(id: string, userId: number): Promise<Response> {
  const session = ownedUpload(id, userId);
  if (session === null) {
    return new Response("Upload not found", { status: 404 });
  }
  await discard(session);
  return new Response(null, { status: 204 });
}

export function mediaUploadResponse(
  req: Request,
  pathname: string,
  options: MediaUploadOptions,
): Response | Promise<Response> {
  if (pathname === "/api/media/uploads" && req.method === "POST") {
    return startUpload(req, options);
  }
  const route = uploadRoute(pathname);
  if (route === null) {
    return new Response("Not found", { status: 404 });
  }
  if (route.complete && req.method === "POST") {
    return completeUpload(route.id, options);
  }
  if (!route.complete && req.method === "POST") {
    return appendChunk(req, route.id, options.userId);
  }
  if (!route.complete && req.method === "DELETE") {
    return cancelUpload(route.id, options.userId);
  }
  return new Response("Method not allowed", { status: 405 });
}

function uploadRoute(pathname: string): { readonly id: string; readonly complete: boolean } | null {
  const groups = /^\/api\/media\/uploads\/(?<id>[0-9a-f-]+)(?<complete>\/complete)?$/u.exec(pathname)?.groups;
  const id = groups?.["id"];
  if (id === undefined) {
    return null;
  }
  return { id, complete: groups?.["complete"] !== undefined };
}
