import { useCallback, useState, type RefObject } from "react";
import { plural } from "./text.js";
import type { ManagerModel } from "./useManagerModel.js";
import type { OperationRunner } from "./useOperationRunner.js";
import type { SelectionState } from "./useSelection.js";

export type Dialog =
  | { readonly type: "move"; readonly ids: readonly string[] }
  | { readonly type: "delete"; readonly ids: readonly string[] }
  | { readonly type: "create"; readonly parentId: string | null }
  | { readonly type: "folders" }
  | { readonly type: "view" };

export interface DialogsInput<M> {
  readonly model: ManagerModel<M>;
  readonly runner: OperationRunner;
  readonly selection: SelectionState<M>;
  readonly folderId: string | null;
  readonly expand: (id: string) => void;
}

/** Which sheet is open and the host error it shows. Busy sheets refuse to close. */
function useDialogState(pendingRef: RefObject<boolean>) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const show = useCallback((next: Dialog) => {
    setDialogError(null);
    setDialog(next);
  }, []);
  const closeDialog = useCallback(() => {
    if (!pendingRef.current) {
      setDialog(null);
      setDialogError(null);
    }
  }, [pendingRef]);
  const hideDialog = useCallback(() => setDialog(null), []);
  return { dialog, dialogError, setDialogError, show, closeDialog, hideDialog };
}

type DialogState = ReturnType<typeof useDialogState>;

/** Confirm handlers: each asks the host, then closes the sheet or shows why it failed. */
function useDialogSubmits<M>({ model, runner, selection, expand }: DialogsInput<M>, { hideDialog, setDialogError }: DialogState) {
  const { index, labels } = model;
  const { run } = runner;
  const { commit } = selection;
  const submitMove = useCallback(async (ids: readonly string[], targetId: string | null) => {
    const name = targetId === null ? labels.root : index.byId.get(targetId)?.name ?? "";
    const error = await run({ operation: { type: "move", ids, targetId }, label: "Moving", done: `Moved ${plural(ids.length, "item")} to ${name}`, openId: targetId });
    if (error === null) {
      hideDialog();
      commit([]);
    } else {
      setDialogError(error);
    }
  }, [index, labels.root, run, hideDialog, commit, setDialogError]);
  const submitDelete = useCallback(async (ids: readonly string[]) => {
    const [first = ""] = ids;
    const name = ids.length === 1 ? `“${index.byId.get(first)?.name ?? ""}”` : plural(ids.length, "item");
    const error = await run({ operation: { type: "delete", ids }, label: "Deleting", done: `Deleted ${name}` });
    if (error === null) {
      hideDialog();
      commit([]);
    } else {
      setDialogError(error);
    }
  }, [index, run, hideDialog, commit, setDialogError]);
  const submitCreate = useCallback(async (parentId: string | null, name: string) => {
    const error = await run({ operation: { type: "create-folder", parentId, name }, label: "Creating", done: `Created “${name}”` });
    if (error !== null) {
      setDialogError(error);
      return;
    }
    hideDialog();
    if (parentId !== null) {
      expand(parentId);
    }
  }, [run, hideDialog, expand, setDialogError]);
  return { submitMove, submitDelete, submitCreate };
}

/** Sheets and drawers: opening them (locks permitting) and confirming them. */
export function useDialogs<M>(input: DialogsInput<M>) {
  const { model: { blocking }, runner, folderId } = input;
  const state = useDialogState(runner.pendingRef);
  const { show } = state;
  const openMove = useCallback((ids: readonly string[]) => {
    if (ids.length > 0 && blocking(ids, "move") === null) {
      show({ type: "move", ids });
    }
  }, [blocking, show]);
  const openDelete = useCallback((ids: readonly string[]) => {
    if (ids.length > 0 && blocking(ids, "delete") === null) {
      show({ type: "delete", ids });
    }
  }, [blocking, show]);
  const openCreate = useCallback(() => show({ type: "create", parentId: folderId }), [show, folderId]);
  const openFolders = useCallback(() => show({ type: "folders" }), [show]);
  const openViewSheet = useCallback(() => show({ type: "view" }), [show]);
  const submits = useDialogSubmits(input, state);
  return { ...state, openMove, openDelete, openCreate, openFolders, openViewSheet, ...submits };
}

export type Dialogs = ReturnType<typeof useDialogs>;
