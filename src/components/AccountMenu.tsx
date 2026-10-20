import { useCallback } from "react";
import { LogOut, Settings, UserRound } from "lucide-react";
import type { AuthUser } from "../types.ts";
import { useLogout } from "../hooks/useAuth.ts";
import { navigateToAdmin, navigateToProfile } from "../hooks/useMediaRoute.ts";
import { useHeaderPopover } from "../hooks/useHeaderPopover.ts";
import { preloadAdminApp, preloadProfileApp } from "../routeModules.ts";
import { AccountAvatar } from "./AccountAvatar.tsx";

const ITEM = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-foreground/85 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 aria-[current=page]:bg-accent aria-[current=page]:text-foreground";

interface MenuItemProps {
  readonly current: boolean;
  readonly onSelect: () => void;
  readonly onPreload: () => void;
  readonly children: React.ReactNode;
}

function MenuItem({ current, onSelect, onPreload, children }: MenuItemProps): React.JSX.Element {
  return (
    <button type="button" onClick={onSelect} onFocus={onPreload} onPointerEnter={onPreload} aria-current={current ? "page" : undefined} className={ITEM}>
      {children}
    </button>
  );
}

function SignOutItem(): React.JSX.Element {
  const logout = useLogout();
  const handleLogout = useCallback(() => logout.mutate(), [logout]);
  return (
    <>
      <button type="button" onClick={handleLogout} disabled={logout.isPending} className={ITEM}>
        <LogOut className="size-4" />
        Sign out
      </button>
      {logout.status === "error" && <p role="alert" className="select-text px-2.5 pb-1 text-xs text-destructive">{logout.error.message}</p>}
    </>
  );
}

/** Avatar button; its menu holds Profile, Admin (admins) and Sign out. The logo goes to the library. */
export function AccountMenu({ user, view }: { readonly user: AuthUser; readonly view: "library" | "admin" | "profile" }): React.JSX.Element {
  const { id, triggerRef, panelRef, open, handleBeforeToggle, handleToggle, handleClose } = useHeaderPopover();
  const handleProfile = useCallback(() => {
    handleClose();
    navigateToProfile();
  }, [handleClose]);
  const handleAdmin = useCallback(() => {
    handleClose();
    navigateToAdmin();
  }, [handleClose]);
  return (
    <>
      <button ref={triggerRef} type="button" aria-label="Account" aria-expanded={open} aria-controls={id} popoverTarget={id} onPointerEnter={preloadProfileApp} data-active={open || view !== "library"} className="shrink-0 rounded-full p-0.5 ring-primary focus-visible:outline-none focus-visible:ring-2 data-[active=true]:ring-2">
        <AccountAvatar username={user.username} />
      </button>
      <div ref={panelRef} id={id} popover="auto" onBeforeToggle={handleBeforeToggle} onToggle={handleToggle} aria-label="Account" className="fixed inset-auto m-0 w-56 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-black p-1.5 text-sm text-foreground shadow-lg">
        <div className="mb-1.5 border-b border-border px-2.5 pb-2.5 pt-1.5">
          <p className="truncate font-semibold">{user.username}</p>
          {user.isAdmin && <p className="text-xs text-muted-foreground">Admin</p>}
        </div>
        <MenuItem current={view === "profile"} onSelect={handleProfile} onPreload={preloadProfileApp}>
          <UserRound className="size-4" />
          Profile
        </MenuItem>
        {user.isAdmin && (
          <MenuItem current={view === "admin"} onSelect={handleAdmin} onPreload={preloadAdminApp}>
            <Settings className="size-4" />
            Admin
          </MenuItem>
        )}
        <SignOutItem />
      </div>
    </>
  );
}
