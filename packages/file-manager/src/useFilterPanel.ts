import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import { toggledSet } from "./folders.js";
import { checkedKeys, collectValues, filterForKeys, type FilterMode, type ValueRow } from "./filterValues.js";
import type { ColumnContext, ColumnFilter, FileColumn, FileItem } from "./types.js";

export interface FilterPanelInput<M> {
  readonly column: FileColumn<M>;
  readonly items: readonly FileItem<M>[];
  readonly context: ColumnContext<M>;
  readonly filter: ColumnFilter | undefined;
  readonly onChange: (filter: ColumnFilter | undefined) => void;
}

function rowsMatching(rows: readonly ValueRow[], query: string): readonly ValueRow[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle === "" ? rows : rows.filter((row) => row.label.toLocaleLowerCase().includes(needle));
}

function withRows(checked: ReadonlySet<string>, rows: readonly ValueRow[], on: boolean): Set<string> {
  const next = new Set(checked);
  for (const row of rows) {
    if (on) {
      next.add(row.key);
    } else {
      next.delete(row.key);
    }
  }
  return next;
}

function filterMode(filter: ColumnFilter | undefined): FilterMode {
  return filter === undefined ? "all" : filter.mode;
}

export function filterForMode(mode: FilterMode): ColumnFilter | undefined {
  return mode === "blank" || mode === "nonblank" ? { mode } : undefined;
}

/** Value list, search and check state behind one column's filter panel. */
export function useFilterPanel<M>({ column, items, context, filter, onChange }: FilterPanelInput<M>) {
  const rows = useMemo(() => collectValues(column, items, context), [column, items, context]);
  const [query, setQuery] = useState("");
  const checked = useMemo(() => checkedKeys(filter, rows), [filter, rows]);
  const shown = useMemo(() => rowsMatching(rows, query), [rows, query]);
  const handleQuery = useCallback((event: ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value), []);
  const handleToggle = useCallback((key: string) => onChange(filterForKeys(rows, toggledSet(checked, key))), [onChange, rows, checked]);
  const handleSelectShown = useCallback(() => onChange(filterForKeys(rows, withRows(checked, shown, true))), [onChange, rows, checked, shown]);
  const handleClearShown = useCallback(() => onChange(filterForKeys(rows, withRows(checked, shown, false))), [onChange, rows, checked, shown]);
  const handleSelectMode = useCallback((mode: FilterMode) => onChange(filterForMode(mode)), [onChange]);
  return { query, handleQuery, checked, shown, handleToggle, handleSelectShown, handleClearShown, handleSelectMode, mode: filterMode(filter) };
}
