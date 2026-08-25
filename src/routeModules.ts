export function loadAdminApp() {
  return import("./components/AdminApp.tsx");
}

export function loadMediaApp() {
  return import("./components/MediaApp.tsx");
}

export function loadPlayer() {
  return import("./components/Player.tsx");
}

export function loadHlsPlayback() {
  return import("./lib/hlsPlayback.ts");
}

export function loadProfileApp() {
  return import("./components/ProfileApp.tsx");
}

function settlePreload(pending: Promise<object>): void {
  void (async (): Promise<void> => {
    try {
      await pending;
    } catch {
      // The route-level error boundary will surface a chunk loading failure.
    }
  })();
}

export function preloadAdminApp(): void {
  settlePreload(loadAdminApp());
}

export function preloadMediaApp(): void {
  settlePreload(loadMediaApp());
}

export function preloadPlayer(): void {
  settlePreload(Promise.all([loadPlayer(), loadHlsPlayback()]));
}

export function preloadProfileApp(): void {
  settlePreload(loadProfileApp());
}
