import { useCallback, useState, type ChangeEvent, type FormEvent } from "react";
import { Download, Gauge, LogOut, Users } from "lucide-react";
import type { AuthUser } from "../types.ts";
import { useLogout, useProvisionUser, useUsers } from "../hooks/useAuth.ts";
import { Input } from "./ui/input.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import { AddTorrentDialog } from "./AddTorrentDialog.tsx";
import { TorrentStatusDialog } from "./TorrentStatusDialog.tsx";

interface UserDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function UserDialog({ open, onOpenChange }: UserDialogProps): React.JSX.Element {
  const [username, setUsername] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [setupToken, setSetupToken] = useState<string>("");
  const users = useUsers(open);
  const provision = useProvisionUser();
  const handleUsernameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setUsername(event.target.value);
  }, []);
  const handleAdminChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setIsAdmin(event.target.checked);
  }, []);
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    provision.mutate({ username, isAdmin }, {
      onSuccess: (token) => {
        setUsername("");
        setSetupToken(token);
      },
    });
  }, [isAdmin, provision, username]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Users</DialogTitle>
          <DialogDescription>
            Provision an account. The user creates their password on first sign-in.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label htmlFor="provision-username" className="min-w-0 flex-1 text-sm font-medium">
            Username
            <Input
              value={username}
              id="provision-username"
              onChange={handleUsernameChange}
              minLength={2}
              maxLength={32}
              className="mt-2"
            />
          </label>
          <label htmlFor="provision-admin" className="flex h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              id="provision-admin"
              checked={isAdmin}
              onChange={handleAdminChange}
              className="size-4 accent-pink-500"
            />
            Admin
          </label>
          <button
            type="submit"
            disabled={username === "" || provision.isPending}
            className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
          >
            Provision
          </button>
        </form>
        {provision.error !== null && (
          <p className="text-sm text-destructive">{provision.error.message}</p>
        )}
        {setupToken !== "" && (
          <div className="rounded-md border border-border bg-muted p-3" aria-live="polite">
            <p className="text-sm font-medium">One-time setup code</p>
            <code className="mt-2 block break-all text-sm text-foreground">{setupToken}</code>
            <p className="mt-2 text-xs text-muted-foreground">
              Send this securely to the user. It cannot be shown again.
            </p>
          </div>
        )}
        <ul className="divide-y divide-border border-t border-border">
          {users.data?.map((user) => (
            <li key={user.id} className="flex items-center justify-between py-3 text-sm">
              <span className="font-medium">{user.username}</span>
              <span className="text-muted-foreground">
                {user.isAdmin ? "Admin · " : ""}{user.passwordSet ? "Active" : "Awaiting setup"}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

interface UserMenuProps {
  readonly user: AuthUser;
  readonly showFolders: readonly string[];
}

export function UserMenu({ user, showFolders }: UserMenuProps): React.JSX.Element {
  const [usersOpen, setUsersOpen] = useState<boolean>(false);
  const [torrentOpen, setTorrentOpen] = useState<boolean>(false);
  const [downloadsOpen, setDownloadsOpen] = useState<boolean>(false);
  const logout = useLogout();
  const handleUsersOpen = useCallback(() => setUsersOpen(true), []);
  const handleTorrentOpen = useCallback(() => setTorrentOpen(true), []);
  const handleDownloadsOpen = useCallback(() => setDownloadsOpen(true), []);
  const handleLogout = useCallback(() => logout.mutate(), [logout]);
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm text-muted-foreground sm:inline">{user.username}</span>
      {user.isAdmin && (
        <button
          type="button"
          onClick={handleDownloadsOpen}
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="View downloads"
          title="View downloads"
        >
          <Gauge className="size-4" />
        </button>
      )}
      {user.isAdmin && (
        <button
          type="button"
          onClick={handleTorrentOpen}
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Add torrent"
          title="Add torrent"
        >
          <Download className="size-4" />
        </button>
      )}
      {user.isAdmin && (
        <button
          type="button"
          onClick={handleUsersOpen}
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Manage users"
          title="Manage users"
        >
          <Users className="size-4" />
        </button>
      )}
      <button
        type="button"
        onClick={handleLogout}
        className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="size-4" />
      </button>
      {user.isAdmin && <UserDialog open={usersOpen} onOpenChange={setUsersOpen} />}
      {user.isAdmin && (
        <AddTorrentDialog
          open={torrentOpen}
          onOpenChange={setTorrentOpen}
          showFolders={showFolders}
        />
      )}
      {user.isAdmin && (
        <TorrentStatusDialog open={downloadsOpen} onOpenChange={setDownloadsOpen} />
      )}
    </div>
  );
}
