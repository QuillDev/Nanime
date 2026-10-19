import { useCallback, useState } from "react";
import { UserPlus } from "lucide-react";
import { useUsers } from "../hooks/useAuth.ts";
import type { ProvisionedUser } from "../types.ts";
import { AdminPage } from "./AdminPage.tsx";
import { InviteUserDialog } from "./InviteUserDialog.tsx";
import { ListSkeleton } from "./Skeleton.tsx";
import { CancelProvisionDialog } from "./UserProvisionDialogs.tsx";

const AVATAR_TONES = ["bg-pink-400", "bg-violet-400", "bg-sky-400", "bg-emerald-400", "bg-amber-300", "bg-rose-300"] as const;

function avatarTone(user: ProvisionedUser): string {
  return user.passwordSet ? AVATAR_TONES[user.id % AVATAR_TONES.length] ?? "bg-pink-400" : "bg-muted";
}

function UserRow({ user }: { readonly user: ProvisionedUser }): React.JSX.Element {
  return (
    <li className="flex items-center gap-4 border-b border-border py-3">
      <span aria-hidden="true" className={`flex size-9 shrink-0 items-center justify-center rounded-full font-display text-sm font-extrabold text-black ${avatarTone(user)} ${user.passwordSet ? "" : "text-muted-foreground"}`}>
        {user.username.slice(0, 1).toLocaleUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="truncate font-semibold">{user.username}</span>
          {user.isAdmin && <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">Admin</span>}
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{user.passwordSet ? "Active" : "Invite pending · waiting for setup"}</p>
      </div>
      {!user.passwordSet && <CancelProvisionDialog user={user} />}
    </li>
  );
}

function UserList(): React.JSX.Element {
  const users = useUsers(true);
  if (users.status === "pending") {
    return <ListSkeleton />;
  }
  if (users.status === "error") {
    return <p className="select-text py-4 text-sm text-destructive">{users.error.message}</p>;
  }
  const ordered = users.data.toSorted((a, b) => Number(a.passwordSet === false) - Number(b.passwordSet === false) || Number(b.isAdmin) - Number(a.isAdmin) || a.username.localeCompare(b.username));
  return <ul>{ordered.map((user) => <UserRow key={user.id} user={user} />)}</ul>;
}

export function AdminUsers(): React.JSX.Element {
  const [inviting, setInviting] = useState(false);
  const handleInvite = useCallback(() => setInviting(true), []);
  const handleClose = useCallback(() => setInviting(false), []);
  return (
    <AdminPage title="Users" actionLabel="Invite user" actionIcon={UserPlus} onAction={handleInvite}>
      <UserList />
      {inviting && <InviteUserDialog onClose={handleClose} />}
    </AdminPage>
  );
}
