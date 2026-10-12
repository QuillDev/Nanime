import { useCallback, useState } from "react";
import { validateRename } from "./names.js";
import type { ManagerModel } from "./useManagerModel.js";
import type { OperationRunner } from "./useOperationRunner.js";

/** Inline rename: which row is editing, its error, and the host round trip. */
export function useRename<M>(model: ManagerModel<M>, runner: OperationRunner) {
  const { index, lockOf, blocking, focusRow } = model;
  const { run, showToast } = runner;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const startRename = useCallback((id: string) => {
    const found = blocking([id], "rename");
    if (found !== null) {
      showToast({ text: found.lock.reason, tone: "error" });
      return;
    }
    setRenamingId(id);
    setRenameError(null);
  }, [blocking, showToast]);
  const cancelRename = useCallback((id: string) => {
    setRenamingId(null);
    setRenameError(null);
    focusRow(id);
  }, [focusRow]);
  const clearRenameError = useCallback(() => setRenameError(null), []);
  const submitRename = useCallback(async (id: string, name: string) => {
    const issue = validateRename(index, id, name, lockOf);
    if (issue !== null) {
      setRenameError(issue.message);
      return;
    }
    const before = index.byId.get(id)?.name ?? "";
    const error = await run({ operation: { type: "rename", id, name }, label: "Renaming", done: `Renamed “${before}” to “${name}”` });
    if (error === null) {
      cancelRename(id);
    } else {
      setRenameError(error);
    }
  }, [index, lockOf, run, cancelRename]);
  return { renamingId, setRenamingId, renameError, startRename, cancelRename, clearRenameError, submitRename };
}

export type RenameState = ReturnType<typeof useRename>;
