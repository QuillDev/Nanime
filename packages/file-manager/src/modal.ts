import { useCallback, useLayoutEffect, useRef, type RefObject, type SyntheticEvent } from "react";

function outsideDialog(event: MouseEvent, dialog: HTMLDialogElement): boolean {
  if (event.target !== dialog) {
    return false;
  }
  const bounds = dialog.getBoundingClientRect();
  return event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom;
}

/** Native backdrop clicks target the dialog; interior blank space does not dismiss it. */
function useBackdrop(panel: RefObject<HTMLDialogElement | null>, onDismiss: (() => void) | null): void {
  useLayoutEffect(() => {
    const dialog = panel.current;
    if (dialog === null || onDismiss === null) {
      return undefined;
    }
    const onClick = (event: MouseEvent) => {
      if (outsideDialog(event, dialog)) {
        onDismiss();
      }
    };
    dialog.addEventListener("click", onClick);
    return () => dialog.removeEventListener("click", onClick);
  }, [panel, onDismiss]);
}

/** Native modality traps focus, makes the background inert, and supports Escape. */
export function useModal(onDismiss: (() => void) | null) {
  const panel = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = panel.current;
    if (dialog === null) {
      return undefined;
    }
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);
  useBackdrop(panel, onDismiss);
  const onCancel = useCallback((event: SyntheticEvent<HTMLDialogElement>) => {
    // React owns the open state; a busy operation must not dismiss its dialog.
    event.preventDefault();
    onDismiss?.();
  }, [onDismiss]);
  return { panel, onCancel };
}
