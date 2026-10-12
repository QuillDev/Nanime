import { isBlank } from "./columns.js";
import { folderFacts } from "./folderFacts.js";
import { childrenOf, formatBytes, pathOf } from "./model.js";
import { LockNote, SelectionActions } from "./SelectionActions.js";
import { plural } from "./text.js";
import type { ColumnContext, FileColumn, FileItem } from "./types.js";
import type { ManagerProps } from "./useFileManager.js";

const LISTED = 8;

interface PropertyProps<M> {
  readonly column: FileColumn<M>;
  readonly item: FileItem<M>;
  readonly context: ColumnContext<M>;
}

/** One column value; folders skip the columns they have no value for. */
function ItemProperty<M>({ column, item, context }: PropertyProps<M>) {
  const value = column.value(item, context);
  const blank = isBlank(value);
  if (item.kind === "folder" && blank) {
    return null;
  }
  return <div><dt>{column.header}</dt><dd data-blank={blank || undefined}>{column.render?.(item, context) ?? column.format?.(value, item) ?? (blank ? "None" : String(value))}</dd></div>;
}

interface SingleProps<M> extends ManagerProps<M> {
  readonly item: FileItem<M>;
}

function SingleDetails<M>({ manager, item }: SingleProps<M>) {
  const { model: { index, labels, columns, context, renderIcon } } = manager;
  return (
    <>
      <div className="nfm-insp-title">
        <span className="nfm-kind nfm-kind--lg">{renderIcon(item, false)}</span>
        <div>
          <h3>{item.name}</h3>
          <p>{pathOf(index, item.parentId, labels.root)}</p>
        </div>
      </div>
      <dl className="nfm-props">
        <div><dt>Kind</dt><dd>{item.kind === "folder" ? `Folder · ${plural(childrenOf(index, item.id).length, "item")}` : "File"}</dd></div>
        {columns.map((column) => <ItemProperty key={column.id} column={column} item={item} context={context} />)}
      </dl>
    </>
  );
}

function SelectionDetails<M>({ manager }: ManagerProps<M>) {
  const { model: { context, renderIcon }, selection: { selectedItems } } = manager;
  const bytes = selectedItems.reduce((sum, item) => sum + context.subtreeSize(item.id), 0);
  return (
    <>
      <div className="nfm-insp-title"><div><h3>{plural(selectedItems.length, "item")}</h3><p>{formatBytes(bytes)}</p></div></div>
      <ul className="nfm-insp-list">
        {selectedItems.slice(0, LISTED).map((item) => <li key={item.id}>{renderIcon(item, false)}<span>{item.name}</span></li>)}
        {selectedItems.length > LISTED && <li className="nfm-dim">and {selectedItems.length - LISTED} more</li>}
      </ul>
    </>
  );
}

function FolderDetails<M>({ manager }: ManagerProps<M>) {
  const { model: { index, labels, context }, navigator: { folderId } } = manager;
  const { currentName } = folderFacts(index, folderId, labels.root);
  const bytes = folderId === null ? [...index.byId.values()].reduce((sum, item) => sum + (item.kind === "file" ? item.size ?? 0 : 0), 0) : context.subtreeSize(folderId);
  return (
    <>
      <div className="nfm-insp-title"><div><h3>{currentName}</h3><p>{plural(childrenOf(index, folderId).length, "item")} · {formatBytes(bytes)}</p></div></div>
      <p className="nfm-insp-empty">Select something to rename, move or delete it.</p>
    </>
  );
}

function Details<M>({ manager }: ManagerProps<M>) {
  const { selectedItems } = manager.selection;
  const [single] = selectedItems;
  if (selectedItems.length === 1 && single !== undefined) {
    return <SingleDetails manager={manager} item={single} />;
  }
  return selectedItems.length > 1 ? <SelectionDetails manager={manager} /> : <FolderDetails manager={manager} />;
}

/** Outline layout: details of the selection (or the folder) and its actions. */
export function Inspector<M>({ manager }: ManagerProps<M>) {
  const { selection: { selected }, rows: { clear } } = manager;
  return (
    <aside className="nfm-inspector" aria-label="Details">
      <Details manager={manager} />
      {selected.length > 0 && (
        <div className="nfm-insp-actions" role="toolbar" aria-label="Selection actions">
          <LockNote manager={manager} />
          <SelectionActions manager={manager} variant="stack" />
          <button type="button" className="nfm-link" onClick={clear}>Clear selection</button>
        </div>
      )}
    </aside>
  );
}
