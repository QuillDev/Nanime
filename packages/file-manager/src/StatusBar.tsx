import { WidgetRole } from "./aria.js";
import { folderFacts } from "./folderFacts.js";
import { formatBytes } from "./model.js";
import { plural } from "./text.js";
import type { ManagerProps } from "./useFileManager.js";

/** Listing count and size, plus what the host is busy doing. */
export function StatusBar<M>({ manager }: ManagerProps<M>) {
  const { model: { index, labels, context }, navigator: { folderId }, listing: { rows, filtering }, runner: { pending } } = manager;
  const { currentName } = folderFacts(index, folderId, labels.root);
  let topLevel = 0;
  let bytes = 0;
  for (const row of rows) {
    if (row.depth === 0) {
      topLevel += 1;
      bytes += context.subtreeSize(row.item.id);
    }
  }
  return (
    <footer className="nfm-status">
      <span>{filtering ? `${plural(rows.length, "result")} in ${currentName}` : plural(topLevel, "item")}<span className="nfm-dim"> · {formatBytes(bytes)}</span></span>
      {pending !== null && <span className="nfm-status-pending" role={WidgetRole.status}>{pending}…</span>}
    </footer>
  );
}
