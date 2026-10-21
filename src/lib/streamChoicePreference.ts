import { useSyncExternalStore } from "react";

/**
 * Advanced feature, off by default: the player's Original/Converted stream
 * choice and its timeline strip. Kept on the device, like player diagnostics.
 */
const STREAM_CHOICE_KEY = "nanime-stream-choice-v1";
const STREAM_CHOICE_EVENT = "nanime:stream-choice-change";
let volatilePreference: boolean | null = null;

function storedPreference(): boolean {
  try {
    return globalThis.localStorage.getItem(STREAM_CHOICE_KEY) === "enabled";
  } catch {
    return false;
  }
}

export function streamChoiceEnabled(): boolean {
  return volatilePreference ?? storedPreference();
}

function subscribePreference(listener: () => void): () => void {
  const handleStorage = (): void => {
    volatilePreference = null;
    listener();
  };
  globalThis.addEventListener(STREAM_CHOICE_EVENT, listener);
  globalThis.addEventListener("storage", handleStorage);
  return () => {
    globalThis.removeEventListener(STREAM_CHOICE_EVENT, listener);
    globalThis.removeEventListener("storage", handleStorage);
  };
}

export function setStreamChoiceEnabled(enabled: boolean): void {
  volatilePreference = enabled;
  try {
    globalThis.localStorage.setItem(STREAM_CHOICE_KEY, enabled ? "enabled" : "disabled");
  } catch {
    // Storage may be off; the current page still gets the change.
  }
  globalThis.dispatchEvent(new Event(STREAM_CHOICE_EVENT));
}

export function useStreamChoiceEnabled(): boolean {
  return useSyncExternalStore(subscribePreference, streamChoiceEnabled, () => false);
}
