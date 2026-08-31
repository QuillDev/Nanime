export type PreferredAudioLanguage = "en" | "ja";

const LANGUAGE_ALIASES = new Map<string, PreferredAudioLanguage>([
  ["en", "en"],
  ["eng", "en"],
  ["ja", "ja"],
  ["jpn", "ja"],
]);

export function normalizedAudioLanguage(language: string): string {
  const base = language.trim().toLowerCase().replaceAll("_", "-").split("-", 1)[0] ?? "";
  return LANGUAGE_ALIASES.get(base) ?? base;
}

export function isPreferredAudioLanguage(value: unknown): value is PreferredAudioLanguage {
  return value === "en" || value === "ja";
}

export function audioLanguageMatches(trackLanguage: string, preferredLanguage: string): boolean {
  return normalizedAudioLanguage(trackLanguage) === normalizedAudioLanguage(preferredLanguage);
}
