import { useCallback, useId, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { selectContents } from "./inputs.js";
import { childrenOf, pathOf, type TreeIndex } from "./model.js";
import { findSibling, validateCreateFolder } from "./names.js";
import { ErrorLine, Sheet, SheetFooter, SheetHeader } from "./Sheet.js";
import { plural } from "./text.js";

export interface CreateFolderDialogProps<M> {
  readonly index: TreeIndex<M>;
  readonly parentId: string | null;
  readonly rootLabel: string;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
}

export function uniqueName<M>(index: TreeIndex<M>, parentId: string | null, base: string): string {
  let name = base;
  for (let n = 2; findSibling(index, parentId, name) !== undefined; n += 1) {
    name = `${base} ${n}`;
  }
  return name;
}

/** Name draft: validated as typed, but errors only show once the user has edited or submitted. */
function useFolderName<M>({ index, parentId, pending, onSubmit }: CreateFolderDialogProps<M>) {
  const [name, setName] = useState(() => uniqueName(index, parentId, "New folder"));
  const [touched, setTouched] = useState(false);
  const issue = validateCreateFolder(index, parentId, name);
  const handleSubmit = useCallback(() => {
    setTouched(true);
    if (issue === null && !pending) {
      onSubmit(name);
    }
  }, [issue, pending, onSubmit, name]);
  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setName(event.currentTarget.value);
    setTouched(true);
  }, []);
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);
  return { name, issue, shownIssue: touched ? issue : null, handleSubmit, handleChange, handleKeyDown };
}

export function CreateFolderDialog<M>(props: CreateFolderDialogProps<M>) {
  const { index, parentId, rootLabel, pending, error, onCancel } = props;
  const draft = useFolderName(props);
  const inputId = useId();
  return (
    <Sheet className="nfm-sheet--small" busy={pending} onClose={onCancel}>
      <SheetHeader title="New folder">In <b>{pathOf(index, parentId, rootLabel)}</b> · {plural(childrenOf(index, parentId).length, "item")}</SheetHeader>
      <div className="nfm-create">
        <label htmlFor={inputId}>Name</label>
        <input
          id={inputId}
          data-autofocus=""
          className="nfm-input"
          value={draft.name}
          aria-invalid={draft.issue !== null}
          spellCheck={false}
          onFocus={selectContents}
          onChange={draft.handleChange}
          onKeyDown={draft.handleKeyDown}
        />
        <p className="nfm-hint" data-error={draft.shownIssue !== null || undefined}>{draft.shownIssue?.message ?? "\u00A0"}</p>
      </div>
      <SheetFooter>
        <ErrorLine error={error} />
        <div className="nfm-foot-row">
          <span className="nfm-foot-note" />
          <button type="button" className="nfm-btn" disabled={pending} onClick={onCancel}>Cancel</button>
          <button type="button" className="nfm-btn nfm-btn--primary" data-testid="create-confirm" disabled={pending || draft.issue !== null} onClick={draft.handleSubmit}>{pending ? "Creating…" : "Create"}</button>
        </div>
      </SheetFooter>
    </Sheet>
  );
}
