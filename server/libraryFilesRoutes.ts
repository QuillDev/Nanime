import type { LibraryFileReference } from "../shared/libraryFiles.ts";
import type { ActivityActor } from "./libraryActivity.ts";
import {
  listLibraryFiles, performLibraryFileOperation, type LibraryFileContext, type LibraryFileRequest,
} from "./libraryFileOperations.ts";
import { LibraryFileError } from "./libraryPaths.ts";

const MAX_ITEMS = 500;
const OPERATION_ID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u;
const NO_STORE = { "cache-control": "no-store" } as const;

interface RequestBody {
  readonly parent?: unknown;
  readonly target?: unknown;
  readonly item?: unknown;
  readonly items?: unknown;
  readonly name?: unknown;
}

function reference(value: unknown): LibraryFileReference | null {
  if (typeof value !== "object" || value === null || !("path" in value) || !("id" in value)) {
    return null;
  }
  const { path, id } = value;
  return typeof path === "string" && typeof id === "string" && id !== "" ? { path, id } : null;
}

function requiredReference(value: unknown): LibraryFileReference {
  const parsed = reference(value);
  if (parsed === null) {
    throw new LibraryFileError(400, "Choose an item from the library.");
  }
  return parsed;
}

function optionalReference(value: unknown): LibraryFileReference | null {
  return value === null || value === undefined ? null : requiredReference(value);
}

function references(value: unknown): readonly LibraryFileReference[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEMS) {
    throw new LibraryFileError(400, `Choose between 1 and ${String(MAX_ITEMS)} items.`);
  }
  return value.map((item) => requiredReference(item));
}

function name(value: unknown): string {
  if (typeof value !== "string") {
    throw new LibraryFileError(400, "Enter a name.");
  }
  return value;
}

async function body(req: Request): Promise<RequestBody> {
  const parsed: unknown = await req.json().catch(() => null);
  if (typeof parsed !== "object" || parsed === null) {
    throw new LibraryFileError(400, "Invalid request body.");
  }
  return parsed;
}

async function parseRequest(req: Request, action: string): Promise<LibraryFileRequest> {
  const revert = /^operations\/(?<id>[^/]+)\/revert$/u.exec(action)?.groups?.["id"];
  if (revert !== undefined) {
    if (!OPERATION_ID.test(revert)) {
      throw new LibraryFileError(404, "That change can't be found, so it can't be undone.");
    }
    return { type: "revert", operationId: revert };
  }
  const payload = await body(req);
  switch (action) {
    case "folders": { return { type: "create-folder", parent: optionalReference(payload.parent), name: name(payload.name) }; }
    case "rename": { return { type: "rename", item: requiredReference(payload.item), name: name(payload.name) }; }
    case "move": { return { type: "move", items: references(payload.items), target: optionalReference(payload.target) }; }
    case "trash": { return { type: "trash", items: references(payload.items) }; }
    default: { throw new LibraryFileError(404, "Not found"); }
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof LibraryFileError) {
    return Response.json({ message: error.message }, { status: error.status, headers: NO_STORE });
  }
  // eslint-disable-next-line no-console
  console.error("Library file request failed", error);
  return Response.json({ message: "The library could not be read or changed. Refresh to check its current state before retrying." }, { status: 500, headers: NO_STORE });
}

export interface LibraryFilesRoute {
  readonly req: Request;
  readonly pathname: string;
  readonly context: LibraryFileContext;
  readonly actor: ActivityActor;
}

/** Admin-only routes under /api/library/files. Callers enforce authorization. */
export async function libraryFilesResponse(route: LibraryFilesRoute): Promise<Response> {
  const { req, pathname, context, actor } = route;
  try {
    if (pathname === "/api/library/files") {
      return req.method === "GET"
        ? Response.json(await listLibraryFiles(context), { headers: NO_STORE })
        : new Response("Method not allowed", { status: 405 });
    }
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const request = await parseRequest(req, pathname.slice("/api/library/files/".length));
    return Response.json(await performLibraryFileOperation({ context, request, actor }), { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
