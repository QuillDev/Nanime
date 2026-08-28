import { describe, expect, test } from "bun:test";
import {
  readPlaybackDiagnosticsPreference,
  writePlaybackDiagnosticsPreference,
  type PreferenceStorage,
} from "./playbackDiagnosticsPreference.ts";

class MemoryStorage implements PreferenceStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("playback diagnostics preference", () => {
  test("is disabled by default and for unknown stored values", () => {
    const storage = new MemoryStorage();

    expect(readPlaybackDiagnosticsPreference(storage)).toBe(false);
    storage.setItem("nanime-playback-diagnostics-v1", "true");
    expect(readPlaybackDiagnosticsPreference(storage)).toBe(false);
  });

  test("persists explicit enabled and disabled choices", () => {
    const storage = new MemoryStorage();

    writePlaybackDiagnosticsPreference(storage, true);
    expect(readPlaybackDiagnosticsPreference(storage)).toBe(true);
    writePlaybackDiagnosticsPreference(storage, false);
    expect(readPlaybackDiagnosticsPreference(storage)).toBe(false);
  });

  test("fails closed when browser storage is unavailable", () => {
    const unavailable: PreferenceStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };

    expect(readPlaybackDiagnosticsPreference(unavailable)).toBe(false);
    expect(() => writePlaybackDiagnosticsPreference(unavailable, true)).not.toThrow();
  });
});
