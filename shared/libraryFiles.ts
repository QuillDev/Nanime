export type LibraryFileKind = "file" | "folder";

export type LibraryFileMedia = "other" | "subtitle" | "video";

export type LibraryFileLockSource =
  | "offline"
  | "recovery"
  | "symlink"
  | "torrent"
  | "torrent-unavailable"
  | "transcode"
  | "upload";

/** Server-enforced reason an entry can't be renamed, moved, or deleted right now. */
export interface LibraryFileLock {
  readonly source: LibraryFileLockSource;
  readonly reason: string;
  readonly tone: "busy" | "locked";
}

/**
 * One entry under the canonical library root. `id` derives from the entry's
 * filesystem identity, so it survives rename and move on the same volume.
 */
export interface LibraryFileItem {
  readonly id: string;
  readonly parentId: string | null;
  readonly path: string;
  readonly name: string;
  readonly kind: LibraryFileKind;
  readonly media: LibraryFileMedia | null;
  readonly size: number | null;
  readonly modifiedAt: number;
  readonly lock: LibraryFileLock | null;
}

export type TorrentOwnershipState = "available" | "unavailable" | "unconfigured";

export interface LibraryFilesSnapshot {
  readonly items: readonly LibraryFileItem[];
  readonly torrentOwnership: TorrentOwnershipState;
  readonly generatedAt: number;
}

/** Identifies an entry by path and by the identity the client last saw there. */
export interface LibraryFileReference {
  readonly path: string;
  readonly id: string;
}

export type LibraryFileOperationKind = "create-folder" | "move" | "rename" | "revert" | "trash";

export interface LibraryFileMovement {
  readonly from: string | null;
  readonly to: string;
}

export interface LibraryFileOperationResult {
  readonly operationId: string;
  readonly kind: LibraryFileOperationKind;
  readonly entries: readonly LibraryFileMovement[];
  readonly revertible: boolean;
}

export interface LibraryMappingMovement {
  readonly from: string;
  readonly to: string;
}

export interface FileOperationActivityState {
  readonly kind: "files";
  readonly operationId: string;
  readonly operation: LibraryFileOperationKind;
  readonly entries: readonly LibraryFileMovement[];
  readonly mappings: readonly LibraryMappingMovement[];
  readonly revertsOperationId: string | null;
}
