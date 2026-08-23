import { useSyncExternalStore } from "react";

function locationSnapshot(): string {
  return `${globalThis.location.pathname}${globalThis.location.search}`;
}

function subscribeToLocation(onChange: () => void): () => void {
  globalThis.addEventListener("popstate", onChange);
  return () => {
    globalThis.removeEventListener("popstate", onChange);
  };
}

function updateUrl(url: URL, replace = false): void {
  const destination = `${url.pathname}${url.search}`;
  if (replace) {
    globalThis.history.replaceState(null, "", destination);
  } else {
    globalThis.history.pushState(null, "", destination);
  }
  globalThis.dispatchEvent(new PopStateEvent("popstate"));
}

export interface MediaRoute {
  readonly admin: boolean;
  readonly adminTab: AdminTab;
  readonly profile: boolean;
  readonly showName: string | null;
  readonly episodeRel: string | null;
  readonly query: string;
}

export type AdminTab = "downloads" | "videos" | "users" | "system";

function adminTabFromUrl(url: URL): AdminTab {
  const tab = url.searchParams.get("tab");
  return tab === "videos" || tab === "users" || tab === "system" ? tab : "downloads";
}

function showFromPath(pathname: string): string | null {
  if (!pathname.startsWith("/shows/")) {
    return null;
  }
  try {
    return decodeURIComponent(pathname.slice("/shows/".length));
  } catch {
    return null;
  }
}

export function useMediaRoute(): MediaRoute {
  const snapshot = useSyncExternalStore(subscribeToLocation, locationSnapshot, () => "/");
  const url = new URL(snapshot, globalThis.location.origin);
  return {
    admin: url.pathname === "/admin",
    adminTab: adminTabFromUrl(url),
    profile: url.pathname === "/profile",
    showName: showFromPath(url.pathname),
    episodeRel: url.searchParams.get("episode"),
    query: url.searchParams.get("q") ?? "",
  };
}

export function navigateToAdminTab(tab: AdminTab): void {
  const url = new URL(globalThis.location.href);
  url.pathname = "/admin";
  if (tab === "downloads") {
    url.searchParams.delete("tab");
  } else {
    url.searchParams.set("tab", tab);
  }
  updateUrl(url);
}

export function navigateToAdmin(): void {
  const url = new URL(globalThis.location.href);
  url.pathname = "/admin";
  url.search = "";
  updateUrl(url);
}

export function navigateToProfile(): void {
  const url = new URL(globalThis.location.href);
  url.pathname = "/profile";
  url.search = "";
  updateUrl(url);
}

export function navigateToLogin(): void {
  const url = new URL(globalThis.location.href);
  url.pathname = "/login";
  url.search = "";
  updateUrl(url, true);
}

export function navigateAfterAuthentication(): void {
  const url = new URL(globalThis.location.href);
  url.pathname = "/";
  url.search = "";
  updateUrl(url, true);
}

export function navigateToShow(showName: string): void {
  const url = new URL(globalThis.location.href);
  url.pathname = `/shows/${encodeURIComponent(showName)}`;
  url.searchParams.delete("episode");
  updateUrl(url);
}

export function navigateToShows(): void {
  const url = new URL(globalThis.location.href);
  url.pathname = "/";
  url.searchParams.delete("episode");
  updateUrl(url);
}

export function navigateToEpisode(rel: string): void {
  const url = new URL(globalThis.location.href);
  url.searchParams.set("episode", rel);
  updateUrl(url);
}

export function closeEpisode(): void {
  const url = new URL(globalThis.location.href);
  url.searchParams.delete("episode");
  updateUrl(url, true);
}

function commitSearch(query: string): void {
  const url = new URL(globalThis.location.href);
  if (query === "") {
    url.searchParams.delete("q");
  } else {
    url.searchParams.set("q", query);
  }
  updateUrl(url, true);
}

export function updateSearch(query: string): void {
  const reduceMotion = globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!("startViewTransition" in document) ||
    typeof document.startViewTransition !== "function" || reduceMotion) {
    commitSearch(query);
    return;
  }
  document.startViewTransition(() => commitSearch(query));
}
