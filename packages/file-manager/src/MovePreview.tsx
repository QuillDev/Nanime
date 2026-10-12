import { useCallback } from "react";
import { ArrowRightIcon, FileIcon, FolderIcon, LockIcon } from "./icons.js";
import type { TreeIndex } from "./model.js";
import { plural } from "./text.js";
import type { FileItem } from "./types.js";
import type { MoveDraft } from "./useMoveDraft.js";

interface PreviewRowProps<M> {
  readonly draft: MoveDraft<M>;
  readonly item: FileItem<M>;
  readonly from: string;
}

function PreviewRow<M>({ draft, item, from }: PreviewRowProps<M>) {
  const { plan, target, targetLabel, leaveOut } = draft;
  const issue = plan?.entries.find((candidate) => candidate.item.id === item.id)?.issue ?? null;
  const exclude = useCallback(() => leaveOut(item.id), [leaveOut, item.id]);
  return (
    <div className="nfm-preview-row" data-issue={issue?.code}>
      <span className="nfm-preview-name">{item.kind === "folder" ? <FolderIcon /> : <FileIcon />}<span>{item.name}</span></span>
      <span className="nfm-preview-path">
        <span>{from}</span>
        <ArrowRightIcon />
        <span data-pending={target === undefined || undefined}>{target === undefined ? "…" : targetLabel}</span>
      </span>
      {issue !== null && (
        <span className="nfm-preview-issue">
          {issue.message}
          <button type="button" className="nfm-link" onClick={exclude}>Leave out</button>
        </span>
      )}
    </div>
  );
}

export interface MovePreviewProps<M> {
  readonly draft: MoveDraft<M>;
  readonly index: TreeIndex<M>;
  readonly rootLabel: string;
}

/** Each moving item with its source, destination and any conflict. */
export function MovePreview<M>({ draft, index, rootLabel }: MovePreviewProps<M>) {
  const { moving, excluded, putBack, plan } = draft;
  return (
    <section className="nfm-preview" aria-label="Move preview">
      {moving.map((id) => {
        const item = index.byId.get(id);
        return item === undefined ? null : <PreviewRow key={id} draft={draft} item={item} from={index.byId.get(item.parentId ?? "")?.name ?? rootLabel} />;
      })}
      {excluded.size > 0 && (
        <p className="nfm-preview-excluded">
          {plural(excluded.size, "item")} left out. <button type="button" className="nfm-link" onClick={putBack}>Put back</button>
        </p>
      )}
      {plan?.blocker?.code === "locked" && <p className="nfm-error"><LockIcon /> <span>{plan.blocker.message}</span></p>}
    </section>
  );
}
