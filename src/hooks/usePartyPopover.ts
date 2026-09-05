import { useCallback, useEffect, useId, useRef, useState, type ToggleEvent } from "react";

export function usePartyPopover() {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const position = useCallback(() => {
    const button = triggerRef.current;
    const popup = panelRef.current;
    if (button === null || popup === null) { return; }
    const bounds = button.getBoundingClientRect();
    const above = innerHeight - bounds.bottom < popup.offsetHeight + 12 && bounds.top > innerHeight - bounds.bottom;
    popup.style.left = `${Math.max(8, Math.min(bounds.right - popup.offsetWidth, innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(8, above ? bounds.top - popup.offsetHeight - 8 : bounds.bottom + 8)}px`;
    popup.style.transformOrigin = above ? "bottom right" : "top right";
  }, []);
  const handleToggle = useCallback((event: ToggleEvent<HTMLDivElement>) => {
    setOpen(event.newState === "open");
    position();
  }, [position]);
  const handleClose = useCallback(() => panelRef.current?.hidePopover(), []);
  useEffect(() => {
    if (!open) { return; }
    const observer = new ResizeObserver(position);
    if (panelRef.current !== null) { observer.observe(panelRef.current); }
    globalThis.addEventListener("resize", position);
    globalThis.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      globalThis.removeEventListener("resize", position);
      globalThis.removeEventListener("scroll", position, true);
    };
  }, [open, position]);
  return { id, triggerRef, panelRef, open, handleToggle, handleClose };
}
