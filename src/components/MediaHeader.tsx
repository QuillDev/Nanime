import type { ChangeEvent } from "react";
import { Library, Settings } from "lucide-react";
import type { AuthUser, ShowMetadata } from "../types.ts";
import type { ShowGroup } from "../lib/library.ts";
import { navigateToAdmin, navigateToShows } from "../hooks/useMediaRoute.ts";
import { BrandLogo } from "./BrandLogo.tsx";
import { LibrarySearch } from "./LibrarySearch.tsx";
import { UserMenu } from "./UserMenu.tsx";
import {
  preloadAdminApp,
  preloadMediaApp,
} from "../routeModules.ts";

type MediaHeaderProps = {
  readonly user: AuthUser;
  readonly view: "library";
  readonly query: string;
  readonly shows: readonly ShowGroup[];
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
    <header className="sticky top-[env(safe-area-inset-top)] z-10 flex items-center gap-2 border-b border-border bg-background px-4 py-4 sm:gap-4 sm:px-6">
      <button
        type="button"
        onClick={navigateToShows}
        onFocus={preloadMediaApp}
        onPointerDown={preloadMediaApp}
        onPointerEnter={preloadMediaApp}
        className="shrink-0 cursor-pointer"
        aria-label="Go to library"
      >
        <BrandLogo className="h-7 w-auto" />
      </button>
      {props.view === "library" && (
        <LibrarySearch
          query={props.query}
          shows={props.shows}
          metadata={props.metadata}
          onQueryChange={props.onQueryChange}
          onShowSelect={props.onShowSelect}
        />
      )}
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
        <UserMenu active={view === "profile"} />
      </nav>
    </header>
  );
}
