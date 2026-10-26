/** The page background for each theme, shared by the meta tag, the toggle, and the manifest. */
export const THEME_COLORS = {
  light: "#fff3f5",
  dark: "#241a20",
} as const;

export type ThemeName = keyof typeof THEME_COLORS;

export function themeColorFor(theme: ThemeName): string {
  return THEME_COLORS[theme];
}
