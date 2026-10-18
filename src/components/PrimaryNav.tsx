import { Library, Settings } from "lucide-react";
import type { AuthUser } from "../types.ts";
import { navigateToAdmin, navigateToShows } from "../hooks/useMediaRoute.ts";
import { preloadAdminApp, preloadMediaApp } from "../routeModules.ts";
import { HeaderActivity } from "./HeaderActivity.tsx";
import { UserMenu } from "./UserMenu.tsx";

/** Library/Admin switch, live activity and the account menu; a bottom bar on touch screens. */
export function PrimaryNav({ user, view }: { readonly user: AuthUser; readonly view: "library" | "admin" | "profile" }): React.JSX.Element {
  return (
    <nav className="mobile-account-controls ml-auto" aria-label="Primary navigation">
      <button
        type="button"
        data-active={view === "library"}
        onClick={navigateToShows}
        onFocus={preloadMediaApp}
        onPointerDown={preloadMediaApp}
        onPointerEnter={preloadMediaApp}
        className="mobile-nav-item"
        aria-label="Library"
      >
        <Library className="size-4" />
        <span className="mobile-nav-label">Library</span>
      </button>
      {user.isAdmin && (
        <button
          type="button"
          data-active={view === "admin"}
          onClick={navigateToAdmin}
          onFocus={preloadAdminApp}
          onPointerDown={preloadAdminApp}
          onPointerEnter={preloadAdminApp}
          className="mobile-nav-item"
          aria-label="Admin dashboard"
        >
          <Settings className="size-4" />
          <span className="mobile-nav-label">Admin</span>
        </button>
      )}
      <HeaderActivity isAdmin={user.isAdmin} />
      <UserMenu active={view === "profile"} />
    </nav>
  );
}
