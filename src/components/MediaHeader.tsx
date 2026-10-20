import type { ChangeEvent } from "react";
import type { AuthUser, ShowMetadata } from "../types.ts";
import type { ShowGroup } from "../lib/library.ts";
import { navigateToShows } from "../hooks/useMediaRoute.ts";
import { BrandLogo } from "./BrandLogo.tsx";
import { HeaderActivity } from "./HeaderActivity.tsx";
import { LibrarySearch } from "./LibrarySearch.tsx";
import { PrimaryNav } from "./PrimaryNav.tsx";
import { useHeaderSurface } from "../hooks/useScrolled.ts";
import { preloadMediaApp } from "../routeModules.ts";

type MediaHeaderProps = {
  readonly user: AuthUser;
  readonly view: "library";
  readonly query: string;
  readonly shows: readonly ShowGroup[];
  readonly metadata: ShowMetadata;
  readonly onQueryChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onShowSelect: (show: ShowGroup) => void;
  /** Transparent over the home banner until the page scrolls. */
  readonly overlay?: boolean;
} | {
  readonly user: AuthUser;
  readonly view: "admin" | "profile";
};

export function MediaHeader(props: MediaHeaderProps): React.JSX.Element {
  const { user, view } = props;
  const surface = useHeaderSurface(props.view === "library" && props.overlay === true);
  return (
    <header className={surface}>
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
      <HeaderActivity isAdmin={user.isAdmin} />
      <PrimaryNav user={user} view={view} />
    </header>
  );
}
