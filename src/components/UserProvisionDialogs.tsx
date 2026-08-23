import { useCallback, useState } from "react";
import { Check, Copy, UserX, X } from "lucide-react";
import type { ProvisionedUser } from "../types.ts";
import { useCancelUserProvision } from "../hooks/useAuth.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";

export interface ProvisionResult {
  readonly username: string;
  readonly setupToken: string;
}

export function ProvisionResultPanel({
  result,
  onClose,
}: {
  readonly result: ProvisionResult | null;
  readonly onClose: () => void;
}): React.JSX.Element | null {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const handleCopy = useCallback(async () => {
    if (result === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(result.setupToken);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }, [result]);
  if (result === null) {
    return null;
  }
  return (
    <section
      aria-live="polite"
      className="mt-4 rounded-lg border border-primary bg-background p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">User provisioned</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Give this code to {result.username} securely. It cannot be retrieved after dismissal.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss setup code"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <label htmlFor="provision-result-code" className="mt-4 block text-sm font-medium">
        One-time setup code
        <Input
          id="provision-result-code"
          value={result.setupToken}
          readOnly
          className="mt-2 font-mono"
        />
      </label>
      <button
        type="button"
        onClick={handleCopy}
        className="mt-3 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
      >
        {copyStatus === "copied" ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copyStatus === "copied" ? "Copied" : "Copy setup code"}
      </button>
      {copyStatus === "failed" && (
        <p className="mt-2 text-sm text-destructive">Copy failed. Select the code above manually.</p>
      )}
    </section>
  );
}

export function CancelProvisionDialog({ user }: { readonly user: ProvisionedUser }): React.JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const cancel = useCancelUserProvision();
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleOpenChange = useCallback((nextOpen: boolean) => setOpen(nextOpen), []);
  const handleKeep = useCallback(() => setOpen(false), []);
  const handleCancel = useCallback(() => {
    cancel.mutate(user.id, { onSuccess: () => setOpen(false) });
  }, [cancel, user.id]);
  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive"
      >
        <UserX className="size-3.5" />
        Cancel provision
      </button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel provision for {user.username}?</DialogTitle>
            <DialogDescription>
              This removes the pending account and invalidates its one-time setup code.
              Active users cannot be removed here.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleKeep}
              className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium"
            >
              Keep provision
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancel.isPending}
              className="rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:bg-muted disabled:text-muted-foreground"
            >
              {cancel.isPending ? "Cancelling…" : "Cancel provision"}
            </button>
          </div>
          {cancel.status === "error" && (
            <p className="text-sm text-destructive">{cancel.error.message}</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
