import type { MediaRoute } from "../hooks/useMediaRoute.ts";

export type LibrarySkeletonPage = "home" | "show" | "results";
export type SkeletonPage = LibrarySkeletonPage | "profile" | "admin";

type PageRoute = Pick<MediaRoute, "admin" | "profile" | "showName" | "query">;

/** Which library layout the URL is about to render, so its placeholder has the same shape. */
export function librarySkeletonPage(route: Pick<PageRoute, "showName" | "query">): LibrarySkeletonPage {
  if (route.showName !== null) {
    return "show";
  }
  return route.query.trim() === "" ? "home" : "results";
}

/** Which page the URL is about to render, known before the session or route chunk loads. */
export function skeletonPage(route: PageRoute): SkeletonPage {
  if (route.admin) {
    return "admin";
  }
  if (route.profile) {
    return "profile";
  }
  return librarySkeletonPage(route);
}
