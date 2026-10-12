import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { messageOf } from "./text.js";
import type { FileOperation, OperationHandler, OperationResult } from "./types.js";

export type UndoAction = NonNullable<OperationResult["undo"]>;

export interface ToastContent {
  readonly text: string;
  readonly tone: "ok" | "error";
  readonly undo?: UndoAction | undefined;
  /** Folder the toast can jump to; `null` is the root. */
  readonly openId?: string | null | undefined;
}

export interface Toast extends ToastContent {
  readonly key: number;
}

export interface OperationRequest {
  readonly operation: FileOperation;
  /** Present-tense label shown while the host works, e.g. "Moving". */
  readonly label: string;
  /** Success message when the host doesn't return its own. */
  readonly done: string;
  readonly openId?: string | null;
}

/** Hides each toast after a while; toasts with Undo stay longer. */
function useToastExpiry(toast: Toast | null, setToast: Dispatch<SetStateAction<Toast | null>>): void {
  useEffect(() => {
    if (toast === null) {
      return undefined;
    }
    const timer = setTimeout(() => setToast((current) => (current?.key === toast.key ? null : current)), toast.undo === undefined ? 5000 : 12_000);
    return () => clearTimeout(timer);
  }, [toast, setToast]);
}

/** One host call at a time: `whilePending` skips (resolving `undefined`) while another runs. */
function usePendingLabel() {
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const whilePending = useCallback(async <T>(label: string, task: () => Promise<T>): Promise<T | undefined> => {
    if (pendingRef.current) {
      return undefined;
    }
    pendingRef.current = true;
    setPending(label);
    try {
      return await task();
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }, []);
  return { pending, pendingRef, whilePending };
}

/**
 * Sends operations to the host one at a time. `run` resolves to an error
 * message for the dialog that asked, or `null` once the host accepted it.
 */
export function useOperationRunner(onOperation: OperationHandler) {
  const { pending, pendingRef, whilePending } = usePendingLabel();
  const [toast, setToast] = useState<Toast | null>(null);
  const toastKey = useRef(0);
  const showToast = useCallback((content: ToastContent) => {
    toastKey.current += 1;
    setToast({ key: toastKey.current, ...content });
  }, []);
  useToastExpiry(toast, setToast);
  const run = useCallback(async ({ operation, label, done, openId }: OperationRequest): Promise<string | null> => {
    const failure = await whilePending(label, async () => {
      try {
        const result = await onOperation(operation);
        showToast({ text: result?.message ?? done, tone: "ok", undo: result?.undo, openId });
        return null;
      } catch (error) {
        return messageOf(error);
      }
    });
    return failure ?? null;
  }, [whilePending, onOperation, showToast]);
  const undo = useCallback(async (action: UndoAction) => {
    await whilePending("Undoing", async () => {
      setToast(null);
      try {
        await action();
        showToast({ text: "Undone", tone: "ok" });
      } catch (error) {
        showToast({ text: messageOf(error), tone: "error" });
      }
    });
  }, [whilePending, showToast]);
  return { pending, busy: pending !== null, pendingRef, toast, setToast, showToast, run, undo };
}

export type OperationRunner = ReturnType<typeof useOperationRunner>;
