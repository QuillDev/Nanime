import { describe, expect, test } from "bun:test";
import {
  audioLanguageMatches,
  isPreferredAudioLanguage,
  normalizedAudioLanguage,
} from "./audioLanguage.ts";

describe("audio language metadata", () => {
  test("normalizes the common ISO codes used by anime audio tracks", () => {
    expect(normalizedAudioLanguage("jpn")).toBe("ja");
    expect(normalizedAudioLanguage("JA-jp")).toBe("ja");
    expect(normalizedAudioLanguage("eng")).toBe("en");
    expect(audioLanguageMatches("jpn", "ja")).toBe(true);
    expect(audioLanguageMatches("eng", "ja")).toBe(false);
  });

  test("only accepts languages exposed by the account preference", () => {
    expect(isPreferredAudioLanguage("ja")).toBe(true);
    expect(isPreferredAudioLanguage("en")).toBe(true);
    expect(isPreferredAudioLanguage("jpn")).toBe(false);
    expect(isPreferredAudioLanguage(null)).toBe(false);
  });
});
