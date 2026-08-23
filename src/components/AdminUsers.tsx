import { useCallback, useState, type ChangeEvent, type FormEvent } from "react";
import { Users } from "lucide-react";
import { useProvisionUser, useUsers } from "../hooks/useAuth.ts";
import { AdminPanel } from "./AdminPanel.tsx";
import { Input } from "./ui/input.tsx";
import {
  CancelProvisionDialog,
  ProvisionResultPanel,
  type ProvisionResult,
} from "./UserProvisionDialogs.tsx";

export function AdminUsers(): React.JSX.Element {
  const [username, setUsername] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [provisionResult, setProvisionResult] = useState<ProvisionResult | null>(null);
  const users = useUsers(true);
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
        setProvisionResult({ username, setupToken: token });
      },
    });
  }, [isAdmin, provision, username]);
  const handleResultClose = useCallback(() => setProvisionResult(null), []);

  return (
    <AdminPanel
      title="Users"
      description="Provision accounts and review activation status."
      icon={Users}
      className="xl:col-span-3"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 md:flex-row md:items-end">
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
          Administrator
        </label>
        <button
          type="submit"
          disabled={username === "" || provision.isPending}
          className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
        >
          {provision.isPending ? "Provisioning…" : "Provision user"}
        </button>
      </form>
      {provision.error !== null && (
        <p className="mt-4 text-sm text-destructive">{provision.error.message}</p>
      )}
      <ProvisionResultPanel
        key={provisionResult?.setupToken}
        result={provisionResult}
        onClose={handleResultClose}
      />
      {users.status === "error" && (
        <p className="mt-4 text-sm text-destructive">{users.error.message}</p>
      )}
      <ul className="mt-5 divide-y divide-border border-t border-border">
        {users.data?.map((listedUser) => (
          <li key={listedUser.id} className="flex items-center justify-between gap-4 py-4 text-sm">
            <div>
              <p className="font-medium">{listedUser.username}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {listedUser.isAdmin ? "Administrator" : "Viewer"}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={listedUser.passwordSet ? "text-primary" : "text-muted-foreground"}>
                {listedUser.passwordSet ? "Active" : "Awaiting setup"}
              </span>
              {!listedUser.passwordSet && <CancelProvisionDialog user={listedUser} />}
            </div>
          </li>
        ))}
      </ul>
    </AdminPanel>
  );
}
