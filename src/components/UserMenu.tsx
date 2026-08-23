import { useCallback } from "react";
import { LogOut } from "lucide-react";
import type { AuthUser } from "../types.ts";
import { useLogout } from "../hooks/useAuth.ts";

export function UserMenu({ user }: { readonly user: AuthUser }): React.JSX.Element {
  const logout = useLogout();
  const handleLogout = useCallback(() => logout.mutate(), [logout]);
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm text-muted-foreground sm:inline">{user.username}</span>
      <button
        type="button"
        onClick={handleLogout}
        className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}
