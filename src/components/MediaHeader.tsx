import type { ChangeEvent } from "react";
import { Library, Search, Settings } from "lucide-react";
import type { AuthUser } from "../types.ts";
import { navigateToAdmin, navigateToShows } from "../hooks/useMediaRoute.ts";
import { BrandLogo } from "./BrandLogo.tsx";
import { Input } from "./ui/input.tsx";
import { UserMenu } from "./UserMenu.tsx";

type MediaHeaderProps = {
  readonly user: AuthUser;
  readonly view: "library";
  readonly query: string;
  readonly onQueryChange: (event: ChangeEvent<HTMLInputElement>) => void;
} | {
  readonly user: AuthUser;
  readonly view: "admin";
};

export function MediaHeader(props: MediaHeaderProps): React.JSX.Element {
  const { user, view } = props;
  return (
    <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-border bg-background px-6 py-4">
      <BrandLogo className="h-7 w-auto shrink-0" />
      {props.view === "library" && (
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search…"
            value={props.query}
            onChange={props.onQueryChange}
            aria-label="Search library"
            className="pl-9"
          />
        </div>
      )}
      {view === "admin" && <span className="ml-auto text-sm font-medium">Admin</span>}
      {user.isAdmin && (
        <button
          type="button"
          onClick={view === "admin" ? navigateToShows : navigateToAdmin}
          className="inline-flex items-center gap-2 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={view === "admin" ? "Return to library" : "Open admin dashboard"}
          title={view === "admin" ? "Library" : "Admin dashboard"}
        >
          {view === "admin" ? <Library className="size-4" /> : <Settings className="size-4" />}
        </button>
      )}
      <UserMenu user={user} />
    </header>
  );
}
