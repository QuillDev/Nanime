import { BLANK_LABEL, displayValue, isBlank } from "./columns.js";
import type { ColumnContext, ColumnFilter, FileColumn, FileItem } from "./types.js";

export interface ValueRow {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly blank: boolean;
}

export type FilterMode = "all" | ColumnFilter["mode"];

/** Active column filters keyed by column id, in the order they were added. */
export type ColumnFilters = Readonly<Partial<Record<string, ColumnFilter>>>;

interface ValueTally {
  readonly counts: ReadonlyMap<string, number>;
  readonly blanks: number;
}

function tallyValues<M>(column: FileColumn<M>, items: readonly FileItem<M>[], context: ColumnContext<M>): ValueTally {
  const counts = new Map<string, number>();
  let blanks = 0;
  for (const item of items) {
    const value = column.value(item, context);
    if (isBlank(value)) {
      blanks += 1;
    } else {
      const key = displayValue(column, value, item);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return { counts, blanks };
}

export function collectValues<M>(column: FileColumn<M>, items: readonly FileItem<M>[], context: ColumnContext<M>): ValueRow[] {
  const { counts, blanks } = tallyValues(column, items, context);
  const rows: ValueRow[] = [];
  if (blanks > 0) {
    rows.push({ key: BLANK_LABEL, label: "Blank", count: blanks, blank: true });
  }
  for (const [key, count] of [...counts].toSorted(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    rows.push({ key, label: key, count, blank: false });
  }
  return rows;
}

function nonBlankKeys(rows: readonly ValueRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    if (!row.blank) {
      keys.add(row.key);
    }
  }
  return keys;
}

export function checkedKeys(filter: ColumnFilter | undefined, rows: readonly ValueRow[]): Set<string> {
  if (filter === undefined) {
    return new Set(rows.map((row) => row.key));
  }
  switch (filter.mode) {
    case "blank": {
      return new Set([BLANK_LABEL]);
    }
    case "nonblank": {
      return nonBlankKeys(rows);
    }
    case "values": {
      return new Set(filter.values);
    }
  }
}

/** The filter that keeps exactly `checked`, or none when every value is kept. */
export function filterForKeys(rows: readonly ValueRow[], checked: ReadonlySet<string>): ColumnFilter | undefined {
  if (checked.size === rows.length && rows.every((row) => checked.has(row.key))) {
    return undefined;
  }
  const values: string[] = [];
  for (const row of rows) {
    if (checked.has(row.key)) {
      values.push(row.key);
    }
  }
  return { mode: "values", values };
}

function describeValues(values: readonly string[]): string {
  const [only] = values;
  if (values.length !== 1 || only === undefined) {
    return `${values.length} values`;
  }
  return only === BLANK_LABEL ? "blank" : only;
}

export function describeFilter(filter: ColumnFilter): string {
  switch (filter.mode) {
    case "blank": {
      return "blank";
    }
    case "nonblank": {
      return "not blank";
    }
    case "values": {
      return describeValues(filter.values);
    }
  }
}
