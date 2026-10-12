import { useCallback, useMemo, useRef, useState } from "react";
import { existingItems, type TreeIndex } from "./model.js";
import type { FileItem } from "./types.js";

const KEY_SEPARATOR = "\u0000";

function existing<M>(index: TreeIndex<M>, ids: readonly string[]): string[] {
  return ids.filter((id) => index.byId.has(id));
}

/** The row a Shift-range starts from; only handlers read it, so it never re-renders. */
function useAnchor() {
  const anchor = useRef<string | null>(null);
  const setAnchor = useCallback((id: string | null) => {
    anchor.current = id;
  }, []);
  const currentAnchor = useCallback(() => anchor.current, []);
  return { setAnchor, currentAnchor };
}

/**
 * Selected ids in the order the user picked them. Every change goes through
 * `commit`, which reports the surviving ids to the host when they differ from
 * the last report.
 */
export function useSelectionState<M>(index: TreeIndex<M>, onSelectionChange: ((ids: readonly string[], items: readonly FileItem<M>[]) => void) | undefined) {
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const anchor = useAnchor();
  const selected = useMemo(() => existing(index, selection), [selection, index]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedItems = useMemo(() => existingItems(index, selected), [selected, index]);
  const reported = useRef("");
  const commit = useCallback((next: readonly string[]) => {
    setSelection(next);
    const surviving = existing(index, next);
    const key = surviving.join(KEY_SEPARATOR);
    if (key !== reported.current) {
      reported.current = key;
      onSelectionChange?.(surviving, existingItems(index, surviving));
    }
  }, [index, onSelectionChange]);
  return { selection, selected, selectedSet, selectedItems, focusedId, setFocusedId, commit, ...anchor };
}

export type SelectionState<M> = ReturnType<typeof useSelectionState<M>>;
