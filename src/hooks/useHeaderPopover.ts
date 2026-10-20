import { useCallback, useEffect, useId, useRef, useState, type ToggleEvent } from "react";

/**
 * A header popover pinned under its trigger, right edges aligned. It is placed on `beforetoggle`, before the
 * browser first paints it, so it never flashes at the top-left corner; right/top anchoring needs no panel size.
 */
export function useHeaderPopover() {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const position = useCallback(() => {
    const button = triggerRef.current;
    const popup = panelRef.current;
    if (button === null || popup === null) {
      return;
    }
    const bounds = button.getBoundingClientRect();
    popup.style.right = `${String(Math.max(8, innerWidth - bounds.right))}px`;
    popup.style.top = `${String(bounds.bottom + 8)}px`;
  }, []);
  const handleBeforeToggle = useCallback((event: ToggleEvent<HTMLDivElement>) => {
    if (event.newState === "open") {
      position();
    }
  }, [position]);
  const handleToggle = useCallback((event: ToggleEvent<HTMLDivElement>) => {
    setOpen(event.newState === "open");
  }, []);
  const handleClose = useCallback(() => panelRef.current?.hidePopover(), []);
  useEffect(() => {
    if (!open) {
      return;
    }
    globalThis.addEventListener("resize", position);
    return () => {
      globalThis.removeEventListener("resize", position);
    };
  }, [open, position]);
  return { id, triggerRef, panelRef, open, handleBeforeToggle, handleToggle, handleClose };
}
