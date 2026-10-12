import type { CSSProperties } from "react";
import type { FileManagerTheme } from "./types.js";

const THEME_VARIABLES = {
  background: "--fm-bg",
  surface: "--fm-surface",
  muted: "--fm-muted",
  border: "--fm-border",
  ink: "--fm-ink",
  inkMuted: "--fm-ink-muted",
  accent: "--fm-accent",
  accentInk: "--fm-accent-ink",
  danger: "--fm-danger",
  radius: "--fm-radius",
  font: "--fm-font",
} as const satisfies Record<keyof FileManagerTheme, `--fm-${string}`>;

type ThemeVariable = (typeof THEME_VARIABLES)[keyof FileManagerTheme];

/** Root inline style: theme custom properties first, host `style` last so it wins. */
export type RootStyle = CSSProperties & Partial<Record<ThemeVariable, string>>;

function isThemeKey(key: string): key is keyof FileManagerTheme {
  return Object.hasOwn(THEME_VARIABLES, key);
}

/** Maps `theme` props to CSS variables, in the order the host listed them. */
export function rootStyle(theme: Partial<FileManagerTheme> | undefined, style: CSSProperties | undefined): RootStyle {
  const variables: Partial<Record<ThemeVariable, string>> = {};
  for (const [key, value] of Object.entries(theme ?? {})) {
    if (isThemeKey(key) && typeof value === "string") {
      variables[THEME_VARIABLES[key]] = value;
    }
  }
  return { ...variables, ...style };
}
