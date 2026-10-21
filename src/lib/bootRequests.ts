import { currentUserQuery } from "../hooks/useAuth.ts";
import { libraryQuery } from "../hooks/useLibrary.ts";
import { mediaRoute } from "../hooks/useMediaRoute.ts";
import { playbackProgressQuery } from "../hooks/usePlaybackProgress.ts";
import { showMetadataQuery } from "../hooks/useShowMetadata.ts";
import { hasRememberedUser } from "../offline/runtime.ts";
import {
  preloadAdminApp,
  preloadLinkDevicePage,
  preloadMediaApp,
  preloadPlayer,
  preloadProfileApp,
  preloadSignIn,
} from "../routeModules.ts";
import { queryClient } from "./queryClient.ts";

function prefetchLibrary(): void {
  void queryClient.prefetchQuery(libraryQuery);
  void queryClient.prefetchQuery(showMetadataQuery);
  void queryClient.prefetchQuery(playbackProgressQuery);
}

/** The URL's page code, plus its library data for every page but admin. */
function preloadPage(route: ReturnType<typeof mediaRoute>): void {
  if (route.admin) {
    preloadAdminApp();
    return;
  }
  prefetchLibrary();
  if (route.profile) {
    preloadProfileApp();
    return;
  }
  preloadMediaApp();
  if (route.episodeRel !== null) {
    preloadPlayer();
  }
}

/**
 * Starts the session check, the page's code and its library data together,
 * instead of one after another (session, then page chunk, then data). A
 * browser that wasn't signed in last time gets the sign-in screen's code
 * instead, so a signed-out visitor doesn't download the library page or trip
 * three 401s.
 */
export function startBootRequests(): void {
  void queryClient.prefetchQuery(currentUserQuery);
  const route = mediaRoute(new URL(globalThis.location.href));
  if (route.deviceCode !== null) {
    preloadLinkDevicePage();
    return;
  }
  if (!hasRememberedUser()) {
    // Probably signed out: the sign-in screen is the likely first page.
    preloadSignIn();
    return;
  }
  preloadPage(route);
}
