import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShowPreview } from "./ShowPreview.tsx";
import { SessionProviders } from "../components/SessionProviders.tsx";
import { HomePreview, type HomeState } from "./homePreview.tsx";
import { AdminPreview, ProfilePreview, SkeletonPreview } from "./AppPreviews.tsx";
import { isAdminTab, type AdminTab } from "../hooks/useMediaRoute.ts";
import { readyReadiness, renameStateShow } from "./renameFixtures.ts";
import "../styles.css";
import {
  previewJobs, previewProgress, previewReadiness, previewShow, previewUser,
  type PreviewState,
} from "./fixtures.ts";

/**
 * Design preview: the real show page rendered from fixtures, no backend.
 * Open /preview/?state=loading|needs|partial|transcoding|ready (show page)
 * ?state=home-watching|home-fresh (library home)
 * ?state=profile|profile-open (profile page)
 * ?state=rename-episodes|rename-episode (rename dialogs over a release folder), organized (renamed season)
 * or ?state=skeleton-home|show|results|profile|admin (loading placeholders) under `bun run dev`.
 */
const STATES = new Set<PreviewState>(["loading", "needs", "partial", "transcoding", "ready"]);
const HOME_STATES = new Set<HomeState>(["watching", "fresh"]);
const requested = new URL(globalThis.location.href).searchParams.get("state") ?? "";
const homeState = HOME_STATES.has(requested.replace(/^home-/u, "") as HomeState) && requested.startsWith("home-")
  ? requested.replace(/^home-/u, "") as HomeState
  : null;
const state: PreviewState = STATES.has(requested as PreviewState) ? requested as PreviewState : "needs";

// API calls never settle, so seeded data stays on screen and nothing polls a server.
const realFetch = globalThis.fetch.bind(globalThis);
const pending = Promise.withResolvers<Response>().promise;
globalThis.fetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => (
    String(input instanceof Request ? input.url : input).includes("/api/") ? pending : realFetch(input, init)
  ),
  { preconnect: globalThis.fetch.preconnect },
);

const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
const renameState = requested === "rename-episodes" || requested === "rename-episode";
const shownShow = renameStateShow(requested) ?? previewShow;
if (shownShow !== previewShow) {
  client.setQueryData(["playback-readiness", ...shownShow.entries.map((entry) => entry.rel)], readyReadiness(shownShow));
}
// "rename-episodes" opens the season menu's Rename episodes; "rename-episode" the first episode's Rename.
if (renameState) {
  setTimeout(() => {
    const menu = requested === "rename-episodes" ? "summary[aria-label^='More actions']" : "summary[aria-label='Episode actions']";
    document.querySelector<HTMLElement>(menu)?.click();
    setTimeout(() => {
      [...document.querySelectorAll<HTMLButtonElement>("details[open] [role=menuitem]")].find((item) => item.textContent.startsWith("Rename"))?.click();
    }, 100);
  }, 400);
}
const streamed = previewShow.entries.map((entry) => entry.rel);
// "loading" leaves readiness unanswered, the moment before the server replies.
if (state !== "loading") {
  client.setQueryData(["playback-readiness", ...streamed], previewReadiness(state));
}
client.setQueryData(["transcodes"], previewJobs(state));

const profileState = requested === "profile" || requested === "profile-open";
// "profile-open" expands every section so their contents can be reviewed.
if (requested === "profile-open") {
  setTimeout(() => {
    for (const section of document.querySelectorAll("details")) {
      section.open = true;
    }
  }, 300);
}

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("Root container #root is missing");
}
const adminRequest = { "admin-videos-selected": "admin-videos", "admin-users-invite": "admin-users", "admin-notifications": "admin-downloads", "admin-notifications-match": "admin-downloads", "admin-account": "admin-downloads" }[requested] ?? requested;
const adminTab = adminRequest.startsWith("admin-") && isAdminTab(adminRequest.slice(6)) ? adminRequest.slice(6) as AdminTab : null;
// "admin-users-invite" opens the invite dialog.
if (requested === "admin-users-invite") {
  setTimeout(() => {
    [...document.querySelectorAll<HTMLButtonElement>("main header button")].at(0)?.click();
  }, 400);
}
// "admin-notifications" opens the header notification bell; "-match" also opens the first show's match dialog.
if (requested.startsWith("admin-notifications")) {
  setTimeout(() => {
    document.querySelector<HTMLButtonElement>("button[aria-label=Notifications]")?.click();
    if (requested === "admin-notifications-match") {
      document.querySelector<HTMLButtonElement>("[popover] section button")?.click();
    }
  }, 400);
}
// "admin-account" opens the avatar menu.
if (requested === "admin-account") {
  setTimeout(() => {
    document.querySelector<HTMLButtonElement>("button[aria-label=Account]")?.click();
  }, 400);
}
// "admin-videos-selected" expands the first show and selects it, so the bulk bar shows.
if (requested === "admin-videos-selected") {
  setTimeout(() => {
    const show = [...document.querySelectorAll("main ul > li[data-state]")].at(3);
    show?.querySelector<HTMLButtonElement>("[data-slot=collapsible-trigger]")?.click();
    show?.querySelector<HTMLInputElement>("input[type=checkbox]")?.click();
  }, 400);
}

function PreviewPage(): React.JSX.Element {
  if (requested.startsWith("skeleton-")) {
    return <SkeletonPreview page={requested.slice("skeleton-".length)} />;
  }
  if (adminTab !== null) {
    return <AdminPreview tab={adminTab} />;
  }
  if (profileState) {
    return <ProfilePreview />;
  }
  return homeState === null ? <ShowPreview show={shownShow} progress={previewProgress(state)} /> : <HomePreview home={homeState} />;
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <SessionProviders userId={previewUser.id}>
        <PreviewPage />
      </SessionProviders>
    </QueryClientProvider>
  </StrictMode>,
);
