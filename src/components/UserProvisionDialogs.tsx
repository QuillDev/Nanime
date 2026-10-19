import { useCallback, useState } from "react";
import type { ProvisionedUser } from "../types.ts";
import { useCancelUserProvision } from "../hooks/useAuth.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

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
        className="h-8 shrink-0 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-destructive"
      >
        Cancel invite
      </button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel the invite for {user.username}?</DialogTitle>
            <DialogDescription>
              This removes the pending account and its setup code stops working.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleKeep}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Keep invite
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancel.isPending}
              className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:bg-muted disabled:text-muted-foreground"
            >
              {cancel.isPending ? "Cancelling…" : "Cancel invite"}
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
