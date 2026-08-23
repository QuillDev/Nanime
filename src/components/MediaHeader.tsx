import type { ChangeEvent } from "react";
import { Library, Settings } from "lucide-react";
import type { AuthUser, MediaEntry, ShowMetadata } from "../types.ts";
import type { ShowGroup } from "../lib/library.ts";
import { navigateToAdmin, navigateToShows } from "../hooks/useMediaRoute.ts";
import { BrandLogo } from "./BrandLogo.tsx";
import { LibrarySearch } from "./LibrarySearch.tsx";
import { UserMenu } from "./UserMenu.tsx";

type MediaHeaderProps = {
  readonly user: AuthUser;
  readonly view: "library";
  readonly query: string;
  readonly entries: readonly MediaEntry[];
  readonly metadata: ShowMetadata;
  readonly onQueryChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onShowSelect: (show: ShowGroup) => void;
} | {
  readonly user: AuthUser;
  readonly view: "admin" | "profile";
};

export function MediaHeader(props: MediaHeaderProps): React.JSX.Element {
  const { user, view } = props;
  return (
    <header className="sticky top-[env(safe-area-inset-top)] z-10 flex items-center gap-4 border-b border-border bg-background px-6 py-4">
      <BrandLogo className="h-7 w-auto shrink-0" />
      {props.view === "library" && (
        <LibrarySearch
          query={props.query}
          entries={props.entries}
          metadata={props.metadata}
          onQueryChange={props.onQueryChange}
          onShowSelect={props.onShowSelect}
        />
      )}
      {view !== "library" && (
        <span className="ml-auto text-sm font-medium capitalize">{view}</span>
      )}
      <nav className="mobile-account-controls" aria-label="Primary navigation">
        <button
          type="button"
          data-active={view === "library"}
          onClick={navigateToShows}
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
            className="mobile-nav-item"
            aria-label="Admin dashboard"
          >
            <Settings className="size-4" />
            <span className="mobile-nav-label">Admin</span>
          </button>
        )}
        <UserMenu active={view === "profile"} />
      </nav>
    </header>
  );
}
