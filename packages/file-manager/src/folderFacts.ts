import { ancestorsOf, type TreeIndex } from "./model.js";
import type { FileItem } from "./types.js";

export interface FolderFacts<M> {
  /** Folders above the current one, root first. */
  readonly crumbs: readonly FileItem<M>[];
  readonly current: FileItem<M> | null;
  readonly currentName: string;
}

export function folderFacts<M>(index: TreeIndex<M>, folderId: string | null, rootLabel: string): FolderFacts<M> {
  const current = folderId === null ? null : index.byId.get(folderId) ?? null;
  return { crumbs: ancestorsOf(index, folderId), current, currentName: current?.name ?? rootLabel };
}
