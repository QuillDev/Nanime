import { useLayoutEffect, type RefObject } from "react";
import type { TreeIndex } from "./model.js";
import type { FileItem } from "./types.js";

/** Row-level pointer and keyboard handlers, given the item of the row the event came from. */
export interface RowEventHandlers<M> {
  readonly onRowClick: (event: MouseEvent, item: FileItem<M>) => void;
  readonly onRowDoubleClick: (item: FileItem<M>) => void;
  readonly onRowKeyDown: (event: KeyboardEvent, item: FileItem<M>) => void;
}

function rowItem<M>(index: TreeIndex<M>, target: EventTarget | null): FileItem<M> | undefined {
  const row = target instanceof Element ? target.closest<HTMLElement>("[data-nfm-row]") : null;
  const id = row?.dataset["nfmId"];
  return id === undefined ? undefined : index.byId.get(id);
}

/** Checkboxes, disclosure buttons and the rename field handle their own pointer input. */
export function isInsideStopZone(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-nfm-stop]") !== null;
}

/**
 * Delegates clicks, double clicks and keys from every row to one listener on
 * the grid. Checkboxes, disclosure buttons and the rename field sit in
 * `data-nfm-stop` zones and keep their own handlers.
 */
export function useRowEvents<M>(grid: RefObject<HTMLDivElement | null>, index: TreeIndex<M>, handlers: RowEventHandlers<M>): void {
  useLayoutEffect(() => {
    const node = grid.current;
    if (node === null) {
      return undefined;
    }
    const click = (event: MouseEvent) => {
      const item = rowItem(index, event.target);
      if (item !== undefined) {
        handlers.onRowClick(event, item);
      }
    };
    const doubleClick = (event: MouseEvent) => {
      const item = rowItem(index, event.target);
      if (item !== undefined && !isInsideStopZone(event.target)) {
        handlers.onRowDoubleClick(item);
      }
    };
    const keyDown = (event: KeyboardEvent) => {
      const item = rowItem(index, event.target);
      if (item !== undefined) {
        handlers.onRowKeyDown(event, item);
      }
    };
    node.addEventListener("click", click);
    node.addEventListener("dblclick", doubleClick);
    node.addEventListener("keydown", keyDown);
    return () => {
      node.removeEventListener("click", click);
      node.removeEventListener("dblclick", doubleClick);
      node.removeEventListener("keydown", keyDown);
    };
  }, [grid, index, handlers]);
}
