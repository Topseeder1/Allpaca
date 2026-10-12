/**
 * Appearance — theme + font preference persistence.
 *
 * localStorage is the source of truth (see index.html's inline bootstrap,
 * which reads it synchronously before first paint to prevent FOUC). These
 * helpers read it AND mirror the value onto <html data-*> so the CSS applies
 * instantly with no reload.
 *
 * React NEVER writes the attributes at boot — index.html's inline script
 * already did. setTheme()/setFont() are called ONLY from user interaction.
 */

export type ThemeValue =
  | "system"
  | "allpaca-dark"
  | "allpaca-light"
  | "sepia"
  | "high-contrast"
  | "nord"
  | "solarized-dark";

export type FontValue = "system" | "rounded" | "mono" | "serif";

export type ThemeScheme = "light" | "dark";

const THEME_KEY = "allpaca:theme";
const FONT_KEY = "allpaca:font";

export const DEFAULT_THEME: ThemeValue = "system";
export const DEFAULT_FONT: FontValue = "system";

/**
 * Theme name → scheme. MUST mirror:
 *   - the schemeMap in index.html's bootstrap script
 *   - the CSS files in src/styles/themes/
 * Adding a theme means adding it in all three places.
 */
export const THEME_SCHEME: Record<
  Exclude<ThemeValue, "system">,
  ThemeScheme
> = {
  "allpaca-dark": "dark",
  "allpaca-light": "light",
  sepia: "light",
  "high-contrast": "dark",
  nord: "dark",
  "solarized-dark": "dark",
};

export const THEME_OPTIONS: ReadonlyArray<{
  value: ThemeValue;
  label: string;
}> = [
  { value: "system", label: "System" },
  { value: "allpaca-dark", label: "Allpaca Dark" },
  { value: "allpaca-light", label: "Allpaca Light" },
  { value: "sepia", label: "Sepia" },
  { value: "high-contrast", label: "High Contrast" },
  { value: "nord", label: "Nord" },
  { value: "solarized-dark", label: "Solarized Dark" },
];

export const FONT_OPTIONS: ReadonlyArray<{
  value: FontValue;
  label: string;
}> = [
  { value: "system", label: "System" },
  { value: "rounded", label: "Rounded" },
  { value: "mono", label: "Monospace" },
  { value: "serif", label: "Serif" },
];

/**
 * Read the stored theme preference. Unknown values fall back to "system".
 * Never throws — private-mode localStorage can reject access.
 */
export function getTheme(): ThemeValue {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored && (stored === "system" || stored in THEME_SCHEME)) {
      return stored as ThemeValue;
    }
  } catch {
    /* localStorage unavailable — fall through to default */
  }
  return DEFAULT_THEME;
}

export function getFont(): FontValue {
  try {
    const stored = localStorage.getItem(FONT_KEY);
    if (stored && FONT_OPTIONS.some((o) => o.value === stored)) {
      return stored as FontValue;
    }
  } catch {
    /* localStorage unavailable — fall through to default */
  }
  return DEFAULT_FONT;
}

/** Current OS color scheme. Safe on any platform; defaults to "light". */
export function resolveSystemScheme(): ThemeScheme {
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

/**
 * "system" resolves to a concrete theme name for the current OS scheme.
 * Every other value passes through untouched.
 */
export function resolveThemeName(
  theme: ThemeValue,
): Exclude<ThemeValue, "system"> {
  if (theme !== "system") return theme;
  return resolveSystemScheme() === "dark" ? "allpaca-dark" : "allpaca-light";
}

/**
 * Persist + apply a theme choice. Writes localStorage (durable) AND the two
 * <html> attributes (instant CSS application, no reload).
 */
export function setTheme(theme: ThemeValue): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* localStorage unavailable — attribute write below still applies */
  }
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveThemeName(theme));
  root.setAttribute(
    "data-theme-scheme",
    theme === "system" ? resolveSystemScheme() : THEME_SCHEME[theme],
  );
}

/** Persist + apply a font choice. Same contract as setTheme(). */
export function setFont(font: FontValue): void {
  try {
    localStorage.setItem(FONT_KEY, font);
  } catch {
    /* localStorage unavailable — attribute write below still applies */
  }
  document.documentElement.setAttribute("data-font", font);
}