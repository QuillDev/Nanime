import { UserRound } from "lucide-react";
import { navigateToProfile } from "../hooks/useMediaRoute.ts";
import { preloadProfileApp } from "../routeModules.ts";

export function UserMenu({ active }: { readonly active: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      data-active={active}
      onClick={navigateToProfile}
      onFocus={preloadProfileApp}
      onPointerDown={preloadProfileApp}
      onPointerEnter={preloadProfileApp}
      className="mobile-nav-item"
      aria-label="Profile"
    >
      <UserRound className="size-4" />
      <span className="mobile-nav-label">Profile</span>
    </button>
  );
}
