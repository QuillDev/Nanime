import { formatBytes } from "./model.js";
import type { CellValue, ColumnContext, ColumnFilter, FileColumn, FileItem, SortState } from "./types.js";

export const BLANK_LABEL = "(Blank)";

/** Trailing `matchesFilter` arguments: the item under test and the column context. */
export type FilterSubject<M> = readonly [item: FileItem<M>, context: ColumnContext<M>];

/** Trailing `sortItems` arguments: the column definitions and the column context. */
export type SortColumns<M> = readonly [columns: readonly FileColumn<M>[], context: ColumnContext<M>];

export function isBlank(value: CellValue): boolean {
  return value === null || value === undefined || value === "";
}

export function displayValue<M>(column: FileColumn<M>, value: CellValue, item: FileItem<M> | null): string {
  if (column.format !== undefined) {
    return column.format(value, item);
  }
  return isBlank(value) ? "" : String(value);
}

/** Key used for value-selection filters; blanks never appear as a value. */
export function filterKey<M>(column: FileColumn<M>, value: CellValue, item: FileItem<M> | null): string {
  return displayValue(column, value, item);
}

export function matchesFilter<M>(column: FileColumn<M>, filter: ColumnFilter, ...[item, context]: FilterSubject<M>): boolean {
  const value = column.value(item, context);
  switch (filter.mode) {
    case "blank": {
      return isBlank(value);
    }
    case "nonblank": {
      return !isBlank(value);
    }
    case "values": {
      return filter.values.includes(isBlank(value) ? BLANK_LABEL : filterKey(column, value, item));
    }
  }
}

export function compareValues(a: CellValue, b: CellValue): number {
  const blankA = isBlank(a);
  const blankB = isBlank(b);
  if (blankA && blankB) {
    return 0;
  }
  if (blankA || blankB) {
    return blankA ? 1 : -1;
  }
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export const NAME_COLUMN_ID = "name";

function sortColumn<M>(sort: SortState | null, columns: readonly FileColumn<M>[]): FileColumn<M> | undefined {
  return sort === null || sort.columnId === NAME_COLUMN_ID ? undefined : columns.find((candidate) => candidate.id === sort.columnId);
}

export function sortItems<M>(items: readonly FileItem<M>[], sort: SortState | null, ...[columns, context]: SortColumns<M>): FileItem<M>[] {
  const column = sortColumn(sort, columns);
  const factor = sort?.direction === "desc" ? -1 : 1;
  return items.toSorted((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "folder" ? -1 : 1;
    }
    if (column !== undefined) {
      const byValue = compareValues(column.value(a, context), column.value(b, context));
      if (byValue !== 0) {
        // Blanks stay last in both directions.
        const blanks = isBlank(column.value(a, context)) || isBlank(column.value(b, context));
        return blanks ? byValue : byValue * factor;
      }
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) * (column === undefined ? factor : 1);
  });
}

export function sizeColumn<M>(options: { readonly header?: string; readonly width?: string } = {}): FileColumn<M> {
  return {
    id: "size",
    header: options.header ?? "Size",
    width: options.width ?? "88px",
    align: "end",
    sortable: true,
    value: (item, context) => (item.kind === "folder" ? context.subtreeSize(item.id) : item.size),
    format: (value) => (typeof value === "number" ? formatBytes(value) : ""),
  };
}

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

export function modifiedColumn<M>(options: { readonly header?: string; readonly width?: string; readonly minViewport?: number } = {}): FileColumn<M> {
  return {
    id: "modified",
    header: options.header ?? "Modified",
    width: options.width ?? "112px",
    align: "end",
    sortable: true,
    minViewport: options.minViewport ?? 1100,
    value: (item) => item.modifiedAt,
    format: (value) => (typeof value === "number" ? dateFormat.format(value) : ""),
  };
}
