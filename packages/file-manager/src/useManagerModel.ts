import { useCallback, useMemo, type RefObject } from "react";
import { defaultIcon } from "./fileIcons.js";
import { findLock, type FoundLock } from "./locks.js";
import { buildIndex, childrenOf, subtreeSize, topLevelIds, type TreeIndex } from "./model.js";
import type { ColumnContext, FileItem, FileManagerLabels, FileManagerProps, ItemLock, LockableAction } from "./types.js";
import { useElementWidth } from "./useElementWidth.js";

const DEFAULT_LABELS: FileManagerLabels = {
  root: "Files",
  searchPlaceholder: "Search this folder",
  empty: "This folder is empty",
  noResults: "Nothing matches",
};

const NO_COLUMNS: readonly never[] = [];
const COMPACT_BELOW = 720;

/** The manager's root element, used for sizing, focus and keyboard shortcuts. */
export type RootRef = RefObject<HTMLDivElement | null>;

export type BlockingLock<M> = (ids: readonly string[], action: LockableAction) => FoundLock<M> | null;

function columnContext<M>(index: TreeIndex<M>, lockOf: (item: FileItem<M>) => ItemLock | null): ColumnContext<M> {
  const sizes = new Map<string, number>();
  return {
    childCount: (id) => childrenOf(index, id).length,
    subtreeSize: (id) => {
      const cached = sizes.get(id);
      if (cached !== undefined) {
        return cached;
      }
      const size = subtreeSize(index, id);
      sizes.set(id, size);
      return size;
    },
    lockOf,
  };
}

/** Host configuration resolved into the tree index, lock policy and layout facts. */
export function useManagerModel<M>(props: FileManagerProps<M>, rootRef: RootRef) {
  const { items, getLock, caseSensitiveNames, layout = "ledger", labels: labelOverrides, renderIcon: customIcon } = props;
  const width = useElementWidth(rootRef);
  const index = useMemo(() => buildIndex(items, caseSensitiveNames ?? false), [items, caseSensitiveNames]);
  const lockOf = useCallback((item: FileItem<M>): ItemLock | null => getLock?.(item) ?? null, [getLock]);
  const context = useMemo(() => columnContext(index, lockOf), [index, lockOf]);
  const blocking = useCallback<BlockingLock<M>>((ids, action) => findLock(index, topLevelIds(index, ids), action, lockOf), [index, lockOf]);
  const labels = useMemo<FileManagerLabels>(() => ({ ...DEFAULT_LABELS, ...labelOverrides }), [labelOverrides]);
  const renderIcon = useCallback((item: FileItem<M>, open: boolean) => customIcon?.(item) ?? defaultIcon(item, open), [customIcon]);
  const focusRow = useCallback((id: string) => {
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-nfm-row][data-nfm-id="${CSS.escape(id)}"]`)?.focus());
  }, [rootRef]);
  return { rootRef, width, compact: width > 0 && width < COMPACT_BELOW, layout, columns: props.columns ?? NO_COLUMNS, index, lockOf, context, blocking, labels, renderIcon, focusRow };
}

export type ManagerModel<M> = ReturnType<typeof useManagerModel<M>>;
