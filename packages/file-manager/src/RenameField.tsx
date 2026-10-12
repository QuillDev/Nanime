import { useCallback, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { selectContents } from "./inputs.js";
import { splitExtension } from "./names.js";
import type { FileItem } from "./types.js";

export interface RenameFieldProps {
  readonly name: string;
  readonly kind: FileItem["kind"];
  readonly error: string | null;
  readonly pending: boolean;
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
  readonly onEdit: () => void;
}

function useRenameDraft({ name, kind, error, pending, onSubmit, onCancel, onEdit }: RenameFieldProps) {
  const { stem, extension } = kind === "file" ? splitExtension(name) : { stem: name, extension: "" };
  const [value, setValue] = useState(stem);
  const settled = useRef(false);
  const submit = useCallback(() => {
    if (value === stem) {
      settled.current = true;
      onCancel();
    } else {
      onSubmit(`${value}${extension}`);
    }
  }, [value, stem, extension, onCancel, onSubmit]);
  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setValue(event.currentTarget.value);
    onEdit();
  }, [onEdit]);
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      settled.current = true;
      onCancel();
    }
  }, [submit, onCancel]);
  const handleBlur = useCallback(() => {
    if (!settled.current && !pending && error === null) {
      submit();
    }
  }, [pending, error, submit]);
  return { value, extension, handleChange, handleKeyDown, handleBlur };
}

/** What a row needs to host the rename field; ids are filled in per row. */
export interface RenameBinding {
  readonly error: string | null;
  readonly pending: boolean;
  readonly onEdit: () => void;
  readonly onCancel: (id: string) => void;
  readonly onSubmit: (id: string, name: string) => void;
}

/** Edits the stem only; a file keeps its extension as a fixed suffix. */
function RenameField(props: RenameFieldProps) {
  const { name, error, pending } = props;
  const draft = useRenameDraft(props);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (!pending) {
      input.current?.focus();
    }
  }, [pending]);
  return (
    <span className="nfm-rename" data-nfm-stop="" data-error={error !== null || undefined}>
      <span className="nfm-rename-box">
        <input
          ref={input}
          className="nfm-rename-input"
          aria-label={`New name for ${name}`}
          aria-invalid={error !== null}
          value={draft.value}
          disabled={pending}
          spellCheck={false}
          onFocus={selectContents}
          onChange={draft.handleChange}
          onKeyDown={draft.handleKeyDown}
          onBlur={draft.handleBlur}
        />
        {draft.extension !== "" && <span className="nfm-rename-ext" title="Extension is kept">{draft.extension}</span>}
      </span>
      {error !== null && <span className="nfm-rename-error" role="alert">{error} <kbd>Esc</kbd> to cancel</span>}
    </span>
  );
}

export interface RowRenameProps<M> {
  readonly item: FileItem<M>;
  readonly binding: RenameBinding;
}

/** The rename field bound to one row's item. */
export function RowRename<M>({ item, binding }: RowRenameProps<M>) {
  const { error, pending, onEdit, onCancel, onSubmit } = binding;
  const cancel = useCallback(() => onCancel(item.id), [onCancel, item.id]);
  const submit = useCallback((name: string) => onSubmit(item.id, name), [onSubmit, item.id]);
  return <RenameField name={item.name} kind={item.kind} error={error} pending={pending} onEdit={onEdit} onCancel={cancel} onSubmit={submit} />;
}
