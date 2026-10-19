import { useCallback, useState, type ChangeEvent, type FormEvent } from "react";
import { Check, Copy } from "lucide-react";
import { useProvisionUser } from "../hooks/useAuth.ts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";

const primaryButton = "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-semibold text-background hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground";

function SetupCode({ username, code, onDone }: { readonly username: string; readonly code: string; readonly onDone: () => void }): React.JSX.Element {
  const [copy, setCopy] = useState<"copied" | "failed" | "idle">("idle");
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }, [code]);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Invite ready for {username}</DialogTitle>
        <DialogDescription>Send them this one-time setup code. It can’t be shown again after you close this.</DialogDescription>
      </DialogHeader>
      <Input value={code} readOnly aria-label="One-time setup code" className="select-all font-mono" />
      {copy === "failed" && <p className="text-sm text-destructive">Copy failed. Select the code and copy it manually.</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="h-10 rounded-lg px-4 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Done</button>
        <button type="button" onClick={handleCopy} className={primaryButton}>
          {copy === "copied" ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copy === "copied" ? "Copied" : "Copy code"}
        </button>
      </div>
    </>
  );
}

function InviteForm({ onInvited }: { readonly onInvited: (username: string, code: string) => void }): React.JSX.Element {
  const [username, setUsername] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const provision = useProvisionUser();
  const handleUsername = useCallback((event: ChangeEvent<HTMLInputElement>) => setUsername(event.target.value), []);
  const handleAdmin = useCallback((event: ChangeEvent<HTMLInputElement>) => setIsAdmin(event.target.checked), []);
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = username.trim();
    provision.mutate({ username: name, isAdmin }, { onSuccess: (code) => onInvited(name, code) });
  }, [isAdmin, onInvited, provision, username]);
  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Invite user</DialogTitle>
        <DialogDescription>They’ll get a one-time code to set their password.</DialogDescription>
      </DialogHeader>
      <label htmlFor="invite-username" className="text-sm font-medium">
        Username
        <Input id="invite-username" value={username} onChange={handleUsername} minLength={2} maxLength={32} autoComplete="off" required className="mt-2" />
      </label>
      <label className="flex items-center gap-2.5 text-sm">
        <input type="checkbox" checked={isAdmin} onChange={handleAdmin} className="size-4 accent-primary" />
        Admin access
      </label>
      {provision.error !== null && <p className="select-text text-sm text-destructive">{provision.error.message}</p>}
      <div className="flex justify-end">
        <button type="submit" disabled={username.trim().length < 2 || provision.isPending} className={primaryButton}>
          {provision.isPending ? "Creating…" : "Create invite"}
        </button>
      </div>
    </form>
  );
}

export function InviteUserDialog({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const [invite, setInvite] = useState<{ readonly username: string; readonly code: string } | null>(null);
  const handleInvited = useCallback((username: string, code: string) => setInvite({ username, code }), []);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      onClose();
    }
  }, [onClose]);
  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        {invite === null
          ? <InviteForm onInvited={handleInvited} />
          : <SetupCode username={invite.username} code={invite.code} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
