import { useCallback, useMemo } from "react";
import { FileIcon, FolderIcon, LockIcon } from "./icons.js";
import { findLock, type LockResolver } from "./locks.js";
import { descendantsOf, existingItems, formatBytes, topLevelIds, type TreeIndex } from "./model.js";
import { ErrorLine, Sheet, SheetFooter, SheetHeader } from "./Sheet.js";
import { plural } from "./text.js";

const LISTED = 6;

export interface DeleteDialogProps<M> {
  readonly index: TreeIndex<M>;
  readonly ids: readonly string[];
  readonly lockOf: LockResolver<M>;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onSubmit: (ids: readonly string[]) => void;
  readonly onCancel: () => void;
}

/** What a delete removes: the top-level items, the files inside, and their size. */
function deleteSummary<M>({ index, ids, lockOf }: Pick<DeleteDialogProps<M>, "index" | "ids" | "lockOf">) {
  const roots = topLevelIds(index, ids);
  const items = existingItems(index, roots);
  const inner = descendantsOf(index, roots);
  const innerFiles = inner.filter((item) => item.kind === "file");
  const bytes = [...items, ...innerFiles].reduce((sum, item) => sum + (item.kind === "file" ? item.size ?? 0 : 0), 0);
  const [first] = items;
  const title = items.length === 1 ? `Delete “${first?.name ?? ""}”?` : `Delete ${plural(items.length, "item")}?`;
  const where = items.some((item) => item.kind === "folder") ? "the selected folders" : "selection";
  const subtitle = inner.length > 0 ? `Includes ${plural(innerFiles.length, "file")} inside ${where}. ${formatBytes(bytes)} total.` : `${formatBytes(bytes)} total.`;
  return { roots, items, title, subtitle, lock: findLock(index, roots, "delete", lockOf) };
}

function deleteLabel(pending: boolean, error: string | null): string {
  if (pending) {
    return "Deleting…";
  }
  return error === null ? "Delete" : "Try again";
}

/** Confirms a delete, counting what sits inside the selected folders. */
export function DeleteDialog<M>(props: DeleteDialogProps<M>) {
  const { index, ids, lockOf, pending, error, onSubmit, onCancel } = props;
  const { roots, items, title, subtitle, lock } = useMemo(() => deleteSummary({ index, ids, lockOf }), [index, ids, lockOf]);
  const submit = useCallback(() => onSubmit(roots), [onSubmit, roots]);
  return (
    <Sheet className="nfm-sheet--small" busy={pending} onClose={onCancel}>
      <SheetHeader title={title}>{subtitle}</SheetHeader>
      <ul className="nfm-delete-list">
        {items.slice(0, LISTED).map((item) => (
          <li key={item.id}>
            {item.kind === "folder" ? <FolderIcon /> : <FileIcon />}
            <span>{item.name}</span>
            {item.kind === "folder" && <span className="nfm-num">{plural(descendantsOf(index, [item.id]).length, "item")}</span>}
          </li>
        ))}
        {items.length > LISTED && <li className="nfm-sub">and {items.length - LISTED} more</li>}
      </ul>
      <SheetFooter>
        <ErrorLine error={lock === null ? error : null} />
        {lock !== null && <p className="nfm-error"><LockIcon /> <span>{lock.lock.reason}</span></p>}
        <div className="nfm-foot-row">
          <span className="nfm-foot-note" />
          <button type="button" className="nfm-btn" disabled={pending} onClick={onCancel}>Cancel</button>
          <button type="button" className="nfm-btn nfm-btn--danger" data-testid="delete-confirm" disabled={pending || lock !== null} onClick={submit}>{deleteLabel(pending, error)}</button>
        </div>
      </SheetFooter>
    </Sheet>
  );
}
