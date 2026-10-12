import { useCallback, useMemo } from "react";
import { itemPasses, listRows, scopeOf, sideWidth, type ListingQuery } from "./listing.js";
import type { FileColumn } from "./types.js";
import type { ManagerModel } from "./useManagerModel.js";
import type { ListingOptions } from "./useListingOptions.js";

export interface ListingInput<M> {
  readonly model: ManagerModel<M>;
  readonly options: ListingOptions;
  readonly folderId: string | null;
  readonly expanded: ReadonlySet<string>;
}

/** Columns whose `minViewport` fits; nothing is hidden before the first measurement. */
function fittingColumns<M>(columns: readonly FileColumn<M>[], width: number, tableWidth: number): readonly FileColumn<M>[] {
  return columns.filter((column) => column.minViewport === undefined || width === 0 || tableWidth >= column.minViewport);
}

/** Rows the table shows, their order, and the values each filter can offer. */
export function useListing<M>({ model, options, folderId, expanded }: ListingInput<M>) {
  const { index, layout, columns, context, compact, width } = model;
  const { query: search, filters, sort } = options;
  const needle = search.trim().toLocaleLowerCase();
  const query = useMemo<ListingQuery<M>>(() => ({ index, folderId, layout, columns, context, sort, expanded, needle, filters }), [index, folderId, layout, columns, context, sort, expanded, needle, filters]);
  const scope = useMemo(() => scopeOf(index, folderId), [index, folderId]);
  const rows = useMemo(() => listRows(query, scope), [query, scope]);
  const order = useMemo(() => rows.map((row) => row.item.id), [rows]);
  const filterSource = useCallback((columnId: string) => scope.filter((item) => item.kind === "file" && itemPasses({ query, item, skipColumn: columnId })), [scope, query]);
  const visibleColumns = useMemo(() => fittingColumns(columns, width, width - sideWidth(layout, compact, folderId) + 252), [columns, width, layout, compact, folderId]);
  return { filtering: needle !== "" || options.filterIds.length > 0, rows, order, filterSource, visibleColumns };
}

export type Listing<M> = ReturnType<typeof useListing<M>>;
