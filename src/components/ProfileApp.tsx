import { useCallback } from "react";
import { LogOut } from "lucide-react";
import { useLogout } from "../hooks/useAuth.ts";
import type { AuthUser } from "../types.ts";
import { LinkedAccounts } from "./LinkedAccounts.tsx";
import { MediaHeader } from "./MediaHeader.tsx";

export function ProfileApp({ user }: { readonly user: AuthUser }): React.JSX.Element {
  const logout = useLogout();
  const handleLogout = useCallback(() => logout.mutate(), [logout]);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MediaHeader user={user} view="profile" />
      <main className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
        <div className="mt-6 flex items-center justify-between gap-4 border-b border-border pb-6">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Username</p>
            <p className="mt-1 text-xl font-semibold">{user.username}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={logout.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground hover:bg-accent disabled:text-muted-foreground"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
        {logout.status === "error" && (
          <p className="mt-4 select-text text-sm text-destructive">{logout.error.message}</p>
        )}
        <LinkedAccounts />
      </main>
    </div>
  );
}
