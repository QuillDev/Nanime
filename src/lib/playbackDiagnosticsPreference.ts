import { useSyncExternalStore } from "react";

const DIAGNOSTICS_KEY = "nanime-playback-diagnostics-v1";
const DIAGNOSTICS_EVENT = "nanime:playback-diagnostics-change";
let volatilePreference: boolean | null = null;

export interface PreferenceStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

export function readPlaybackDiagnosticsPreference(storage: PreferenceStorage | null): boolean {
  try {
    return storage?.getItem(DIAGNOSTICS_KEY) === "enabled";
  } catch {
    return false;
  }
}

export function writePlaybackDiagnosticsPreference(
  storage: PreferenceStorage | null,
  enabled: boolean,
): void {
  try {
    storage?.setItem(DIAGNOSTICS_KEY, enabled ? "enabled" : "disabled");
  } catch {
    // Browser privacy settings may disable storage; the current page still receives the update.
  }
}

function browserStorage(): PreferenceStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function currentPreference(): boolean {
  return volatilePreference ?? readPlaybackDiagnosticsPreference(browserStorage());
}

function subscribePreference(listener: () => void): () => void {
  const handleStorage = (): void => {
    volatilePreference = null;
    listener();
  };
  globalThis.addEventListener(DIAGNOSTICS_EVENT, listener);
  globalThis.addEventListener("storage", handleStorage);
  return () => {
    globalThis.removeEventListener(DIAGNOSTICS_EVENT, listener);
    globalThis.removeEventListener("storage", handleStorage);
  };
}

export function setPlaybackDiagnosticsEnabled(enabled: boolean): void {
  volatilePreference = enabled;
  writePlaybackDiagnosticsPreference(browserStorage(), enabled);
  globalThis.dispatchEvent(new Event(DIAGNOSTICS_EVENT));
}

export function usePlaybackDiagnosticsEnabled(): boolean {
  return useSyncExternalStore(subscribePreference, currentPreference, () => false);
}
