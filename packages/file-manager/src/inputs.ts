import type { FocusEvent } from "react";

/** Selects a field's text when it gains focus, so typing replaces it. */
export function selectContents(event: FocusEvent<HTMLInputElement>): void {
  event.currentTarget.select();
}

/** Text-entry targets keep their own keys; shortcuts never fire from them. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  return target instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset"].includes(target.type);
}
