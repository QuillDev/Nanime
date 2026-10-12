import { useCallback, useEffect, useState, type RefObject } from "react";
import { NAME_COLUMN_ID } from "./columns.js";
import type { ColumnFilters } from "./filterValues.js";
import type { ColumnFilter, SortState } from "./types.js";

/** An open column-filter popover and where it sits in the viewport. */
export interface OpenFilter {
  readonly id: string;
  readonly top: number;
  readonly left: number;
}

const DEFAULT_SORT: SortState = { columnId: NAME_COLUMN_ID, direction: "asc" };
const NO_FILTERS: ColumnFilters = {};

/** Sorting by a column runs ascending, then descending, then back to name. */
function nextSort(current: SortState, columnId: string): SortState {
  if (current.columnId !== columnId) {
    return { columnId, direction: "asc" };
  }
  if (current.direction === "asc") {
    return { columnId, direction: "desc" };
  }
  return DEFAULT_SORT;
}

function withFilter(current: ColumnFilters, columnId: string, filter: ColumnFilter | undefined): ColumnFilters {
  const next = { ...current };
  if (filter === undefined) {
    delete next[columnId];
  } else {
    next[columnId] = filter;
  }
  return next;
}

/** Anchors the 272px popover under its trigger, kept inside the manager. */
function popoverAt(columnId: string, anchor: HTMLElement, root: HTMLElement | null): OpenFilter {
  const rect = anchor.getBoundingClientRect();
  const right = root?.getBoundingClientRect().right ?? globalThis.innerWidth;
  return { id: columnId, top: rect.bottom + 6, left: Math.max(8, Math.min(rect.right - 272, right - 280)) };
}

function isPopoverTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".nfm-popover, .nfm-hfilter") !== null;
}

/** Closes the popover on outside pointer presses and on Escape anywhere. */
function usePopoverDismiss(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const pointer = (event: PointerEvent) => {
      if (!isPopoverTarget(event.target)) {
        close();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", escape);
    };
  }, [open, close]);
}

/** Column filters and the popover that edits them. */
export function useColumnFilters(rootRef: RefObject<HTMLDivElement | null>) {
  const [filters, setFilters] = useState<ColumnFilters>(NO_FILTERS);
  const [openFilter, setOpenFilter] = useState<OpenFilter | null>(null);
  const setFilter = useCallback((columnId: string, filter: ColumnFilter | undefined) => setFilters((current) => withFilter(current, columnId, filter)), []);
  const clearFilters = useCallback(() => setFilters(NO_FILTERS), []);
  const toggleFilter = useCallback((columnId: string, anchor: HTMLElement) => {
    const next = popoverAt(columnId, anchor, rootRef.current);
    setOpenFilter((open) => (open?.id === columnId ? null : next));
  }, [rootRef]);
  const openFilterAt = useCallback((columnId: string, anchor: HTMLElement) => setOpenFilter(popoverAt(columnId, anchor, rootRef.current)), [rootRef]);
  const closeFilter = useCallback(() => setOpenFilter(null), []);
  usePopoverDismiss(openFilter !== null, closeFilter);
  return { filters, filterIds: Object.keys(filters), setFilter, clearFilters, openFilter, toggleFilter, openFilterAt, closeFilter };
}

/** Search text and sort order for the listing. */
export function useListingOptions(rootRef: RefObject<HTMLDivElement | null>) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const cycleSort = useCallback((columnId: string) => setSort((current) => nextSort(current, columnId)), []);
  const filtering = useColumnFilters(rootRef);
  return { query, setQuery, sort, cycleSort, ...filtering };
}

export type ListingOptions = ReturnType<typeof useListingOptions>;
