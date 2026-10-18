import { useSyncExternalStore } from "react";
import { cn } from "../lib/utils.ts";

const THRESHOLD_PX = 8;

function subscribe(onChange: () => void): () => void {
  globalThis.addEventListener("scroll", onChange, { passive: true });
  return () => {
    globalThis.removeEventListener("scroll", onChange);
  };
}

function pastTop(): boolean {
  return globalThis.scrollY > THRESHOLD_PX;
}

/** Whether the page has scrolled off the top, for headers that turn solid once content passes under them. */
export function useScrolled(): boolean {
  return useSyncExternalStore(subscribe, pastTop, () => false);
}

/** Header classes: transparent over a banner until content scrolls under it, solid otherwise. */
export function useHeaderSurface(overlay: boolean): string {
  const scrolled = useScrolled();
  const transparent = overlay && !scrolled;
  return cn(
    "sticky top-[env(safe-area-inset-top)] z-10 flex h-[var(--header-height)] items-center gap-2 border-b px-4 transition-colors duration-200 sm:gap-4 sm:px-6",
    // The border origin keeps the gradient from repeating into the transparent border as a dark line.
    transparent ? "border-transparent bg-[linear-gradient(180deg,rgb(0_0_0/0.55),transparent)] bg-origin-border" : "border-border bg-background",
  );
}
