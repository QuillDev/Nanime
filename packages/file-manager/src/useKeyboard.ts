import { useCallback, useLayoutEffect, useMemo } from "react";
import { isTextEntry } from "./inputs.js";
import type { FileItem } from "./types.js";
import type { Dialogs } from "./useDialogs.js";
import type { Listing } from "./useListing.js";
import type { ManagerModel } from "./useManagerModel.js";
import type { RenameState } from "./useRename.js";
import type { SelectionState } from "./useSelection.js";

export interface KeyboardInput<M> {
  readonly model: ManagerModel<M>;
  readonly selection: SelectionState<M>;
  readonly listing: Listing<M>;
  readonly rename: RenameState;
  readonly dialogs: Dialogs;
  readonly rows: {
    readonly toggle: (id: string) => void;
    readonly selectRange: (to: string, additive: boolean) => void;
  };
  readonly openItem: (item: FileItem<M>) => void;
}

type RowKeyHandler<M> = (event: KeyboardEvent, item: FileItem<M>) => void;

function isInsideRow(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-nfm-row]") !== null;
}

/** Arrow keys walk the visible rows; Shift extends the selection as they go. */
function useFocusWalk<M>({ model: { focusRow }, selection: { setFocusedId }, listing: { order }, rows: { selectRange } }: KeyboardInput<M>) {
  return useCallback((from: string, step: number, extend: boolean) => {
    const next = order[Math.min(order.length - 1, Math.max(0, order.indexOf(from) + step))];
    if (next !== undefined) {
      setFocusedId(next);
      focusRow(next);
      if (extend) {
        selectRange(next, false);
      }
    }
  }, [order, setFocusedId, focusRow, selectRange]);
}

/** Keys that act on the row holding focus (or containing the focused checkbox). */
function useRowKeys<M>(input: KeyboardInput<M>): RowKeyHandler<M> {
  const { selection: { selectedSet, commit }, listing: { order }, rename: { startRename }, rows: { toggle }, openItem } = input;
  const walk = useFocusWalk(input);
  const handlers = useMemo(() => new Map<string, RowKeyHandler<M>>([
    ["F2", (event, item) => {
      event.preventDefault();
      if (!selectedSet.has(item.id)) {
        commit([item.id]);
      }
      startRename(item.id);
    }],
    ["Enter", (event, item) => {
      if (!(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        openItem(item);
      }
    }],
    [" ", (event, item) => {
      if (event.target instanceof HTMLElement && event.target.dataset["nfmRow"] !== undefined) {
        event.preventDefault();
        toggle(item.id);
      }
    }],
    ["ArrowDown", (event, item) => {
      event.preventDefault();
      walk(item.id, 1, event.shiftKey);
    }],
    ["ArrowUp", (event, item) => {
      event.preventDefault();
      walk(item.id, -1, event.shiftKey);
    }],
    ["a", (event) => {
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        commit(order);
      }
    }],
  ]), [selectedSet, commit, startRename, openItem, toggle, walk, order]);
  const dialogOpen = input.dialogs.dialog !== null;
  return useCallback((event, item) => {
    if (!dialogOpen && !isTextEntry(event.target)) {
      handlers.get(event.key)?.(event, item);
    }
  }, [dialogOpen, handlers]);
}

/**
 * Shortcuts that work anywhere inside the manager: F2 renames the single
 * selection, Delete asks to delete it, Escape clears it. Listening on the
 * root element lets them apply while focus sits on toolbars or the tree.
 */
function useManagerShortcuts<M>({ model: { rootRef }, selection: { selected, commit }, rename: { startRename }, dialogs: { dialog, openDelete } }: KeyboardInput<M>): void {
  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (dialog !== null || isTextEntry(event.target) || selected.length === 0) {
      return;
    }
    const [only] = selected;
    if (event.key === "F2" && !isInsideRow(event.target) && selected.length === 1 && only !== undefined) {
      event.preventDefault();
      startRename(only);
    } else if (event.key === "Delete") {
      event.preventDefault();
      openDelete(selected);
    } else if (event.key === "Escape") {
      event.preventDefault();
      commit([]);
    }
  }, [dialog, selected, startRename, openDelete, commit]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    root?.addEventListener("keydown", onKeyDown);
    return () => root?.removeEventListener("keydown", onKeyDown);
  }, [rootRef, onKeyDown]);
}

/** Installs the manager shortcuts and returns the per-row key handler. */
export function useKeyboard<M>(input: KeyboardInput<M>): RowKeyHandler<M> {
  useManagerShortcuts(input);
  return useRowKeys(input);
}
