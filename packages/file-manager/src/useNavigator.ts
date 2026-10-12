import { useCallback, useState } from "react";
import { toggledSet } from "./folders.js";
import { ancestorsOf, type TreeIndex } from "./model.js";
import type { FileManagerProps } from "./types.js";
import type { RenameState } from "./useRename.js";
import type { SelectionState } from "./useSelection.js";

const NOTHING: readonly string[] = [];

export interface NavigatorInput<M> {
  readonly props: Pick<FileManagerProps<M>, "folderId" | "onFolderChange" | "defaultFolderId" | "defaultExpandedIds">;
  readonly index: TreeIndex<M>;
  readonly selection: SelectionState<M>;
  readonly rename: RenameState;
  readonly setQuery: (query: string) => void;
}

function pathIds<M>(index: TreeIndex<M>, id: string | null): string[] {
  return id === null ? [] : [...ancestorsOf(index, id).map((node) => node.id), id];
}

/** Only an existing folder can be current; anything else falls back to the root. */
function currentFolder<M>(index: TreeIndex<M>, requested: string | null): string | null {
  return requested === null || index.byId.get(requested)?.kind !== "folder" ? null : requested;
}

/** Current folder (controlled or not) and the expanded folders of the tree. */
export function useNavigator<M>({ props, index, selection, rename, setQuery }: NavigatorInput<M>) {
  const { folderId: controlled, onFolderChange, defaultFolderId, defaultExpandedIds } = props;
  const [ownFolder, setOwnFolder] = useState<string | null>(defaultFolderId ?? null);
  const requested = controlled === undefined ? ownFolder : controlled;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([...(defaultExpandedIds ?? []), ...pathIds(index, requested)]));
  const { commit, setAnchor, setFocusedId } = selection;
  const { setRenamingId } = rename;
  /** Opens a folder and starts fresh there; the cascade passes the file it revealed as `nextSelection`. */
  const navigate = useCallback((id: string | null, nextSelection: readonly string[] = NOTHING) => {
    if (controlled === undefined) {
      setOwnFolder(id);
    }
    onFolderChange?.(id);
    commit(nextSelection);
    setAnchor(null);
    setFocusedId(null);
    setRenamingId(null);
    setQuery("");
    setExpanded((current) => (id === null ? current : new Set([...current, ...pathIds(index, id)])));
  }, [controlled, onFolderChange, commit, setAnchor, setFocusedId, setRenamingId, setQuery, index]);
  const toggleExpanded = useCallback((id: string) => setExpanded((current) => toggledSet(current, id)), []);
  const expand = useCallback((id: string) => setExpanded((current) => new Set([...current, id])), []);
  return { folderId: currentFolder(index, requested), expanded, navigate, toggleExpanded, expand };
}

export type Navigator = ReturnType<typeof useNavigator>;
