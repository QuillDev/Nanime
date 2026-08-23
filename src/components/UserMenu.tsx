import { UserRound } from "lucide-react";
import { navigateToProfile } from "../hooks/useMediaRoute.ts";

export function UserMenu({ active }: { readonly active: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      data-active={active}
      onClick={navigateToProfile}
      className="mobile-nav-item"
      aria-label="Profile"
    >
      <UserRound className="size-4" />
      <span className="mobile-nav-label">Profile</span>
    </button>
  );
}
