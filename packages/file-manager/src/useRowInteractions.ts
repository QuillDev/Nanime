import { useCallback } from "react";
import type { FileItem } from "./types.js";
import type { Dialogs } from "./useDialogs.js";
import { useKeyboard } from "./useKeyboard.js";
import type { Listing } from "./useListing.js";
import type { ManagerModel } from "./useManagerModel.js";
import type { Navigator } from "./useNavigator.js";
import type { RenameState } from "./useRename.js";
import { isInsideStopZone } from "./useRowEvents.js";
import type { SelectionState } from "./useSelection.js";

export interface InteractionInput<M> {
  readonly model: ManagerModel<M>;
  readonly selection: SelectionState<M>;
  readonly listing: Listing<M>;
  readonly navigator: Navigator;
  readonly rename: RenameState;
  readonly dialogs: Dialogs;
  readonly onOpenFile: ((item: FileItem<M>) => void) | undefined;
}

function without(ids: readonly string[], removed: readonly string[]): string[] {
  const drop = new Set(removed);
  return ids.filter((id) => !drop.has(id));
}

/** Selection edits in terms of the visible row order. */
function useRowSelection<M>({ selection, listing }: InteractionInput<M>) {
  const { selection: current, selected, selectedSet, commit, setAnchor, currentAnchor } = selection;
  const { order } = listing;
  const toggle = useCallback((id: string) => {
    commit(current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]);
    setAnchor(id);
  }, [commit, current, setAnchor]);
  const selectOnly = useCallback((id: string) => {
    commit([id]);
    setAnchor(id);
  }, [commit, setAnchor]);
  const selectRange = useCallback((to: string, additive: boolean) => {
    const from = order.indexOf(currentAnchor() ?? to);
    const end = order.indexOf(to);
    if (from === -1 || end === -1) {
      selectOnly(to);
      return;
    }
    const range = order.slice(Math.min(from, end), Math.max(from, end) + 1);
    commit(additive ? [...without(current, range), ...range] : range);
  }, [order, currentAnchor, selectOnly, commit, current]);
  const checkAll = useCallback(() => {
    const rest = without(selected, order);
    commit(order.length > 0 && order.every((id) => selectedSet.has(id)) ? rest : [...rest, ...order]);
  }, [order, selected, selectedSet, commit]);
  const clear = useCallback(() => commit([]), [commit]);
  return { toggle, selectOnly, selectRange, checkAll, clear };
}

export type RowSelection = ReturnType<typeof useRowSelection>;

/** Pointer behaviour of rows: desktop selection modifiers, touch tap-to-open. */
function useRowPointer<M>(input: InteractionInput<M>, rows: RowSelection) {
  const { selection: { selected, setFocusedId, currentAnchor }, navigator: { navigate }, onOpenFile } = input;
  const { toggle, selectOnly, selectRange } = rows;
  const openItem = useCallback((item: FileItem<M>) => {
    if (item.kind === "folder") {
      navigate(item.id);
    } else {
      onOpenFile?.(item);
    }
  }, [navigate, onOpenFile]);
  const tap = useCallback((item: FileItem<M>) => {
    if (selected.length === 0 && item.kind === "folder") {
      navigate(item.id);
    } else {
      toggle(item.id);
    }
  }, [selected.length, navigate, toggle]);
  const onRowClick = useCallback((event: MouseEvent, item: FileItem<M>) => {
    if (isInsideStopZone(event.target)) {
      return;
    }
    setFocusedId(item.id);
    const touch = event instanceof PointerEvent ? event.pointerType === "touch" || event.pointerType === "pen" : matchMedia("(hover: none) and (pointer: coarse)").matches;
    if (touch) {
      tap(item);
    } else if (event.shiftKey) {
      selectRange(item.id, event.metaKey || event.ctrlKey);
    } else if (event.metaKey || event.ctrlKey) {
      toggle(item.id);
    } else {
      selectOnly(item.id);
    }
  }, [setFocusedId, tap, selectRange, toggle, selectOnly]);
  const onCheck = useCallback((item: FileItem<M>, range: boolean) => {
    setFocusedId(item.id);
    if (range && currentAnchor() !== null) {
      selectRange(item.id, true);
    } else {
      toggle(item.id);
    }
  }, [setFocusedId, currentAnchor, selectRange, toggle]);
  return { openItem, onRowClick, onCheck };
}

/** Everything a row (and the keyboard) can do to selection and navigation. */
export function useRowInteractions<M>(input: InteractionInput<M>) {
  const rows = useRowSelection(input);
  const pointer = useRowPointer(input, rows);
  const onRowKeyDown = useKeyboard({ ...input, rows, openItem: pointer.openItem });
  return { ...rows, ...pointer, onRowKeyDown, onToggleExpand: input.navigator.toggleExpanded };
}

export type RowInteractions = ReturnType<typeof useRowInteractions>;
