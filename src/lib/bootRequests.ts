import { currentUserQuery } from "../hooks/useAuth.ts";
import { libraryQuery } from "../hooks/useLibrary.ts";
import { mediaRoute } from "../hooks/useMediaRoute.ts";
import { playbackProgressQuery } from "../hooks/usePlaybackProgress.ts";
import { showMetadataQuery } from "../hooks/useShowMetadata.ts";
import { hasRememberedUser } from "../offline/runtime.ts";
import { preloadAdminApp, preloadMediaApp, preloadPlayer, preloadProfileApp } from "../routeModules.ts";
import { queryClient } from "./queryClient.ts";

function preloadPage(route: ReturnType<typeof mediaRoute>): void {
  if (route.admin) {
    preloadAdminApp();
    return;
  }
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
 * instead of one after another (session, then page chunk, then data). Only a
 * browser that was signed in last time fetches data before the session check,
 * so a signed-out visitor doesn't trip three 401s.
 */
export function startBootRequests(): void {
  void queryClient.prefetchQuery(currentUserQuery);
  const route = mediaRoute(new URL(globalThis.location.href));
  if (route.deviceCode !== null) {
    return;
  }
  preloadPage(route);
  if (route.admin || !hasRememberedUser()) {
    return;
  }
  void queryClient.prefetchQuery(libraryQuery);
  void queryClient.prefetchQuery(showMetadataQuery);
  void queryClient.prefetchQuery(playbackProgressQuery);
}
