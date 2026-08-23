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
  readonly showName: string | null;
  readonly episodeRel: string | null;
  readonly query: string;
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
    showName: showFromPath(url.pathname),
    episodeRel: url.searchParams.get("episode"),
    query: url.searchParams.get("q") ?? "",
  };
}

export function navigateToAdmin(): void {
  const url = new URL(globalThis.location.href);
  url.pathname = "/admin";
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

export function updateSearch(query: string): void {
  const url = new URL(globalThis.location.href);
  if (query === "") {
    url.searchParams.delete("q");
  } else {
    url.searchParams.set("q", query);
  }
  updateUrl(url, true);
}
