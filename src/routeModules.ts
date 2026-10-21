import type { ComponentProps } from "react";
import type { AdminApp as AdminAppComponent } from "./components/AdminApp.tsx";
import type { MediaApp as MediaAppComponent } from "./components/MediaApp.tsx";
import type { PlaybackGate as PlaybackGateComponent } from "./components/PlaybackGate.tsx";
import type { Player as PlayerComponent } from "./components/Player.tsx";
import type { ProfileApp as ProfileAppComponent } from "./components/ProfileApp.tsx";
import { instantLazy } from "./lib/instantLazy.ts";

export const AdminAppRoute = instantLazy<ComponentProps<typeof AdminAppComponent>>(
  async () => {
    const module = await import("./components/AdminApp.tsx");
    return module.AdminApp;
  },
);
export const MediaAppRoute = instantLazy<ComponentProps<typeof MediaAppComponent>>(
  async () => {
    const module = await import("./components/MediaApp.tsx");
    return module.MediaApp;
  },
);
export const ProfileAppRoute = instantLazy<ComponentProps<typeof ProfileAppComponent>>(
  async () => {
    const module = await import("./components/ProfileApp.tsx");
    return module.ProfileApp;
  },
);
export const PlayerChunk = instantLazy<ComponentProps<typeof PlayerComponent>>(
  async () => {
    const module = await import("./components/Player.tsx");
    return module.Player;
  },
);
export const PlaybackGateChunk = instantLazy<ComponentProps<typeof PlaybackGateComponent>>(
  async () => {
    const module = await import("./components/PlaybackGate.tsx");
    return module.PlaybackGate;
  },
);

export function loadHlsPlayback() {
  return import("./lib/hlsPlayback.ts");
}

function settlePreload(pending: Promise<unknown>): void {
  void (async (): Promise<void> => {
    try {
      await pending;
    } catch {
      // The route-level error boundary will surface a chunk loading failure.
    }
  })();
}

export function preloadAdminApp(): void {
  settlePreload(AdminAppRoute.load());
}

export function preloadMediaApp(): void {
  settlePreload(MediaAppRoute.load());
}

export function preloadPlayer(): void {
  settlePreload(Promise.all([PlayerChunk.load(), PlaybackGateChunk.load(), loadHlsPlayback()]));
}

/** Warms the player once the page has settled, so its 600 KB of code never competes with the library's first requests. */
export function preloadPlayerWhenIdle(): () => void {
  if (typeof globalThis.requestIdleCallback === "function") {
    const handle = globalThis.requestIdleCallback(preloadPlayer, { timeout: 3000 });
    return () => globalThis.cancelIdleCallback(handle);
  }
  const handle = globalThis.setTimeout(preloadPlayer, 1500);
  return () => globalThis.clearTimeout(handle);
}

export function preloadProfileApp(): void {
  settlePreload(ProfileAppRoute.load());
}
