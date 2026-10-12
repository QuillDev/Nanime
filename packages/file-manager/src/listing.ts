import { matchesFilter, sortItems } from "./columns.js";
import type { ColumnFilters } from "./filterValues.js";
import { ancestorsOf, childrenOf, descendantsOf, type TreeIndex } from "./model.js";
import type { TableRowModel } from "./TableRow.js";
import type { ColumnContext, FileColumn, FileItem, FileManagerLayout, SortState } from "./types.js";

/** Everything that decides which rows the table shows and in what order. */
export interface ListingQuery<M> {
  readonly index: TreeIndex<M>;
  readonly folderId: string | null;
  readonly layout: FileManagerLayout;
  readonly columns: readonly FileColumn<M>[];
  readonly context: ColumnContext<M>;
  readonly sort: SortState;
  readonly expanded: ReadonlySet<string>;
  /** Lower-cased, trimmed search text. */
  readonly needle: string;
  readonly filters: ColumnFilters;
}

interface PassCheck<M> {
  readonly query: ListingQuery<M>;
  readonly item: FileItem<M>;
  /** Column whose own filter is ignored, so its value list can offer every option. */
  readonly skipColumn?: string | undefined;
}

/** Width the side panel of each layout takes from the table. */
export function sideWidth(layout: FileManagerLayout, compact: boolean, folderId: string | null): number {
  if (compact) {
    return 0;
  }
  if (layout === "ledger") {
    return 252;
  }
  if (layout === "outline") {
    return 312;
  }
  return folderId === null ? 0 : 400;
}

export function itemPasses<M>({ query, item, skipColumn }: PassCheck<M>): boolean {
  const { needle, filters, columns, context } = query;
  if (needle !== "" && !item.name.toLocaleLowerCase().includes(needle)) {
    return false;
  }
  const active = Object.keys(filters).filter((id) => id !== skipColumn);
  if (active.length === 0) {
    return true;
  }
  return item.kind !== "folder" && active.every((id) => {
    const column = columns.find((candidate) => candidate.id === id);
    const filter = filters[id];
    return column === undefined || filter === undefined || matchesFilter(column, filter, item, context);
  });
}

/** Search and filter scope: everything under the current folder. */
export function scopeOf<M>(index: TreeIndex<M>, folderId: string | null): FileItem<M>[] {
  return folderId === null ? [...index.byId.values()] : descendantsOf(index, [folderId]);
}

function relativePath<M>(query: ListingQuery<M>, item: FileItem<M>): string {
  const chain = ancestorsOf(query.index, item.id);
  const start = query.folderId === null ? 0 : chain.findIndex((node) => node.id === query.folderId) + 1;
  const rest = chain.slice(start).map((node) => node.name);
  return rest.length === 0 ? "Here" : rest.join(" / ");
}

function sortedChildren<M>(query: ListingQuery<M>, parentId: string | null): FileItem<M>[] {
  return sortItems(childrenOf(query.index, parentId), query.sort, query.columns, query.context);
}

/** Rows of the outline tree: each folder followed by its children while expanded. */
function outlineRows<M>(query: ListingQuery<M>, folderId: string | null): TableRowModel<M>[] {
  const out: TableRowModel<M>[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const item of sortedChildren(query, parentId)) {
      const hasChildren = item.kind === "folder" && childrenOf(query.index, item.id).length > 0;
      const open = hasChildren && query.expanded.has(item.id);
      out.push({ item, depth, expanded: hasChildren ? open : null, path: null });
      if (open) {
        walk(item.id, depth + 1);
      }
    }
  };
  walk(folderId, 0);
  return out;
}

/** Search results across the scope, or the folder listing (a tree in the outline layout). */
export function listRows<M>(query: ListingQuery<M>, scope: readonly FileItem<M>[]): TableRowModel<M>[] {
  if (query.needle !== "" || Object.keys(query.filters).length > 0) {
    const matches = scope.filter((item) => itemPasses({ query, item }));
    return sortItems(matches, query.sort, query.columns, query.context).map((item) => ({ item, depth: 0, expanded: null, path: relativePath(query, item) }));
  }
  if (query.layout !== "outline") {
    return sortedChildren(query, query.folderId).map((item) => ({ item, depth: 0, expanded: null, path: null }));
  }
  return outlineRows(query, query.folderId);
}
