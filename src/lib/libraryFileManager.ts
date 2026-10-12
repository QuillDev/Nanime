import type { FileColumn, FileItem, FileOperation, ItemLock } from "@nanime/file-manager";
import type { LibraryFileItem, LibraryFileLock, LibraryFileOperationResult, LibraryFileReference } from "../../shared/libraryFiles.ts";
import type { LibraryFileRequest } from "../libraryFilesApi.ts";

export type LibraryFile = FileItem<LibraryFileItem>;

export function libraryFileItems(items: readonly LibraryFileItem[]): readonly LibraryFile[] {
  return items.map((item) => {
    const base = { id: item.id, parentId: item.parentId, name: item.name, kind: item.kind, modifiedAt: item.modifiedAt, metadata: item };
    return item.size === null ? base : { ...base, size: item.size };
  });
}

function referenceTo(byId: ReadonlyMap<string, LibraryFileItem>, id: string): LibraryFileReference {
  const item = byId.get(id);
  if (item === undefined) {
    throw new Error("That item is no longer in the library. Refresh and try again.");
  }
  return { path: item.path, id: item.id };
}

function optionalReference(byId: ReadonlyMap<string, LibraryFileItem>, id: string | null): LibraryFileReference | null {
  return id === null ? null : referenceTo(byId, id);
}

/** Translates the file manager's generic operation into Nanime's verified path + identity request. */
export function libraryFileRequest(operation: FileOperation, byId: ReadonlyMap<string, LibraryFileItem>): LibraryFileRequest {
  switch (operation.type) {
    case "create-folder": {
      return { type: "create-folder", parent: optionalReference(byId, operation.parentId), name: operation.name };
    }
    case "rename": {
      return { type: "rename", item: referenceTo(byId, operation.id), name: operation.name };
    }
    case "move": {
      return { type: "move", items: operation.ids.map((id) => referenceTo(byId, id)), target: optionalReference(byId, operation.targetId) };
    }
    case "delete": {
      return { type: "trash", items: operation.ids.map((id) => referenceTo(byId, id)) };
    }
    default: {
      throw new Error("Unsupported file operation");
    }
  }
}

function countLabel(count: number): string {
  return count === 1 ? "1 item" : `${String(count)} items`;
}

/** Success text that says what really happened: deletion is a recoverable move to trash. */
export function operationMessage(result: LibraryFileOperationResult): string | undefined {
  if (result.kind === "trash") {
    const [first] = result.entries;
    const from = result.entries.length === 1 ? first?.from ?? null : null;
    const subject = from === null ? countLabel(result.entries.length) : `“${from.slice(from.lastIndexOf("/") + 1)}”`;
    return `Moved ${subject} to Nanime's trash`;
  }
  return undefined;
}

export function libraryFileLock(item: LibraryFile): ItemLock | null {
  const lock = item.metadata?.lock ?? null;
  return lock === null ? null : { reason: lock.reason, tone: lock.tone };
}

const STATUS_LABELS = {
  offline: "Preparing offline copy",
  recovery: "Needs recovery",
  symlink: "Symbolic link",
  torrent: "Seeding",
  "torrent-unavailable": "Ownership unknown",
  transcode: "Transcoding",
  upload: "Uploading",
} as const satisfies Readonly<Record<LibraryFileLock["source"], string>>;

export function lockStatus(lock: LibraryFileLock | null): string | null {
  if (lock === null) {
    return null;
  }
  return lock.source === "torrent" && lock.tone === "busy" ? "Downloading" : STATUS_LABELS[lock.source];
}

const MEDIA_LABELS = { video: "Video", subtitle: "Subtitles", other: "Other" } as const;

function mediaLabel(media: LibraryFileItem["media"]): string | null {
  return media === null ? null : MEDIA_LABELS[media];
}

export const LIBRARY_FILE_COLUMNS: readonly FileColumn<LibraryFileItem>[] = [
  {
    id: "type",
    header: "Type",
    width: "112px",
    filterable: true,
    minViewport: 820,
    value: (item) => mediaLabel(item.metadata?.media ?? null),
  },
  {
    id: "status",
    header: "Status",
    width: "minmax(112px, 0.5fr)",
    filterable: true,
    minViewport: 960,
    value: (item) => lockStatus(item.metadata?.lock ?? null),
  },
];
