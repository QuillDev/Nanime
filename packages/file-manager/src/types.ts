import type { CSSProperties, ReactNode } from "react";

export type FileKind = "file" | "folder";

/**
 * One node in the host-owned tree. `id` must stay stable across rename and
 * move; `parentId === null` means the item lives at the root.
 */
export interface FileItem<M = unknown> {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly kind: FileKind;
  /** Bytes. Folders may omit it; the size column sums descendants. */
  readonly size?: number;
  /** Epoch milliseconds. */
  readonly modifiedAt?: number;
  readonly metadata?: M;
}

export type LockableAction = "rename" | "move" | "delete";

/** Host policy describing why an item can't be changed right now. */
export interface ItemLock {
  /** Short, user-facing explanation shown next to disabled actions. */
  readonly reason: string;
  /** Actions blocked by this lock. Defaults to every mutating action. */
  readonly blocks?: readonly LockableAction[];
  /** `busy` renders a live indicator, `locked` a static lock. */
  readonly tone?: "busy" | "locked";
}

export type FileOperation =
  | { readonly type: "create-folder"; readonly parentId: string | null; readonly name: string }
  | { readonly type: "rename"; readonly id: string; readonly name: string }
  | { readonly type: "move"; readonly ids: readonly string[]; readonly targetId: string | null }
  | { readonly type: "delete"; readonly ids: readonly string[] };

export interface OperationResult {
  /** Optional reversal the host knows how to perform; surfaces an Undo action. */
  readonly undo?: () => Promise<void> | void;
  /** Overrides the default success message. */
  readonly message?: string;
}

/**
 * Hosts perform every write. Throw (or reject) to report failure: the
 * component keeps its dialog open, shows `error.message`, and never mutates
 * anything itself. Update `items` atomically once the write has landed.
 */
export type OperationHandler = (operation: FileOperation) => Promise<OperationResult | void> | OperationResult | void;

export interface ColumnContext<M = unknown> {
  readonly childCount: (id: string) => number;
  readonly subtreeSize: (id: string) => number;
  readonly lockOf: (item: FileItem<M>) => ItemLock | null;
}

export type CellValue = string | number | null | undefined;

export interface FileColumn<M = unknown> {
  readonly id: string;
  readonly header: string;
  /** Raw value used for sorting, filtering and default rendering. */
  readonly value: (item: FileItem<M>, context: ColumnContext<M>) => CellValue;
  /** Display text for a value in cells and filter lists. */
  readonly format?: (value: CellValue, item: FileItem<M> | null) => string;
  readonly render?: (item: FileItem<M>, context: ColumnContext<M>) => ReactNode;
  /** CSS grid track, e.g. `"96px"` or `"minmax(80px, 0.6fr)"`. */
  readonly width?: string;
  readonly align?: "start" | "end";
  readonly sortable?: boolean;
  /** Enables the searchable value filter with blank / not blank modes. */
  readonly filterable?: boolean;
  /** Hidden below this container width (px). */
  readonly minViewport?: number;
}

export type SortDirection = "asc" | "desc";
export interface SortState {
  readonly columnId: string;
  readonly direction: SortDirection;
}

export type ColumnFilter =
  | { readonly mode: "blank" }
  | { readonly mode: "nonblank" }
  | { readonly mode: "values"; readonly values: readonly string[] };

export type FileManagerLayout = "ledger" | "cascade" | "outline";

export interface FileManagerTheme {
  readonly background: string;
  readonly surface: string;
  readonly muted: string;
  readonly border: string;
  readonly ink: string;
  readonly inkMuted: string;
  readonly accent: string;
  readonly accentInk: string;
  readonly danger: string;
  readonly radius: string;
  readonly font: string;
}

export interface FileManagerLabels {
  readonly root: string;
  readonly searchPlaceholder: string;
  readonly empty: string;
  readonly noResults: string;
}

export interface FileManagerProps<M = unknown> {
  readonly items: readonly FileItem<M>[];
  readonly onOperation: OperationHandler;
  readonly columns?: readonly FileColumn<M>[];
  readonly getLock?: (item: FileItem<M>) => ItemLock | null | undefined;
  /** Called with ids in the order the user selected them. */
  readonly onSelectionChange?: (ids: readonly string[], items: readonly FileItem<M>[]) => void;
  /** Double-click / Enter on a file. Folders always navigate. */
  readonly onOpenFile?: (item: FileItem<M>) => void;
  /** Controlled current folder. Omit to let the component manage it. */
  readonly folderId?: string | null;
  readonly onFolderChange?: (id: string | null) => void;
  readonly defaultFolderId?: string | null;
  /** Folders initially expanded in the tree rail and outline. */
  readonly defaultExpandedIds?: readonly string[];
  readonly layout?: FileManagerLayout;
  readonly labels?: Partial<FileManagerLabels>;
  readonly theme?: Partial<FileManagerTheme>;
  /** Folder name comparison. Defaults to case-insensitive to be safe on every filesystem. */
  readonly caseSensitiveNames?: boolean;
  readonly renderIcon?: (item: FileItem<M>) => ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}
