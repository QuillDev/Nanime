import { api, unwrap } from "./api.ts";
import type { LibraryFileOperationResult, LibraryFileReference, LibraryFilesSnapshot } from "../shared/libraryFiles.ts";

export type LibraryFileRequest =
  | { readonly type: "create-folder"; readonly parent: LibraryFileReference | null; readonly name: string }
  | { readonly type: "move"; readonly items: readonly LibraryFileReference[]; readonly target: LibraryFileReference | null }
  | { readonly type: "rename"; readonly item: LibraryFileReference; readonly name: string }
  | { readonly type: "revert"; readonly operationId: string }
  | { readonly type: "trash"; readonly items: readonly LibraryFileReference[] };

export async function fetchLibraryFiles(signal: AbortSignal): Promise<LibraryFilesSnapshot> {
  return unwrap(await api.api.library.files.get({ fetch: { signal } }), "Library files request");
}

const { files } = api.api.library;

export interface EpisodeNamesBody {
  readonly folder: string;
  readonly showFolder: string | null;
  readonly seasonFolder: string | null;
  readonly episodes: readonly { readonly rel: string; readonly name: string }[];
}

export async function sendEpisodeNames(body: EpisodeNamesBody): Promise<{ readonly folder: string; readonly stoppedSeeding: boolean }> {
  return unwrap(await files["episode-names"].post({ ...body, episodes: [...body.episodes] }), "Renaming episodes");
}

export async function sendLibraryFileRequest(request: LibraryFileRequest): Promise<LibraryFileOperationResult> {
  switch (request.type) {
    case "create-folder": {
      return unwrap(await files.folders.post({ parent: request.parent, name: request.name }), "Creating the folder");
    }
    case "rename": {
      return unwrap(await files.rename.post({ item: request.item, name: request.name }), "Renaming");
    }
    case "move": {
      return unwrap(await files.move.post({ items: [...request.items], target: request.target }), "Moving");
    }
    case "trash": {
      return unwrap(await files.trash.post({ items: [...request.items] }), "Moving to trash");
    }
    case "revert": {
      return unwrap(await files.operations({ id: request.operationId }).revert.post(), "Undoing");
    }
    default: {
      throw new Error("Unknown library file request");
    }
  }
}
