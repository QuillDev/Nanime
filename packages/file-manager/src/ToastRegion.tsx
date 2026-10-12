import { useCallback } from "react";
import { CloseIcon, LockIcon } from "./icons.js";
import type { ManagerProps } from "./useFileManager.js";
import type { Toast } from "./useOperationRunner.js";

interface ToastViewProps<M> extends ManagerProps<M> {
  readonly toast: Toast;
}

function ToastView<M>({ manager, toast }: ToastViewProps<M>) {
  const { navigator: { folderId, navigate }, runner: { busy, setToast, undo } } = manager;
  const { openId, undo: undoAction } = toast;
  const dismiss = useCallback(() => setToast(null), [setToast]);
  const open = useCallback(() => {
    navigate(openId ?? null);
    setToast(null);
  }, [navigate, openId, setToast]);
  const revert = useCallback(async () => {
    if (undoAction !== undefined) {
      await undo(undoAction);
    }
  }, [undo, undoAction]);
  return (
    <div className="nfm-toast" data-tone={toast.tone} role={toast.tone === "error" ? "alert" : "status"}>
      {toast.tone === "error" && <LockIcon />}
      <span>{toast.text}</span>
      {openId !== undefined && openId !== folderId && <button type="button" className="nfm-link" onClick={open}>Open</button>}
      {undoAction !== undefined && <button type="button" className="nfm-link nfm-link--accent" disabled={busy} onClick={revert}>Undo</button>}
      <button type="button" className="nfm-iconbtn nfm-iconbtn--sm" aria-label="Dismiss" onClick={dismiss}><CloseIcon /></button>
    </div>
  );
}

/** Live region for operation results, with Open and Undo where the host allows. */
export function ToastRegion<M>({ manager }: ManagerProps<M>) {
  const { toast } = manager.runner;
  return (
    <div className="nfm-toasts" aria-live="polite">
      {toast !== null && <ToastView key={toast.key} manager={manager} toast={toast} />}
    </div>
  );
}
