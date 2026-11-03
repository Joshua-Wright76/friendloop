/** The page background for each theme, shared by the meta tag, the toggle, and the manifest. */
export const THEME_COLORS = {
  light: "#fff3f5",
  dark: "#241a20",
} as const;

export type ThemeName = keyof typeof THEME_COLORS;

export function themeColorFor(theme: ThemeName): string {
  return THEME_COLORS[theme];
}

/* ------------------------------------------------------------------ */
/* Loop stationery: curated presets plus an accent the owner can pick. */
/* ------------------------------------------------------------------ */

/**
 * Gingham Picnic is not a preset in this table: it is the stylesheet itself.
 * A loop with no stored theme gets no overrides at all, so it renders exactly as
 * it did before themes existed. The owner changes the paper, never the prose.
 */
export const DEFAULT_PRESET = "gingham";

/** The tokens a loop can restyle, per colour scheme. Fonts, radii, and copy are not among them. */
export type PaperTokens = {
  page: string;
  check: string;
  card: string;
  line: string;
  lineStrong: string;
  controlLine: string;
  field: string;
  rule: string;
  margin: string;
  ink: string;
  inkSoft: string;
  inkMuted: string;
  tape: string;
};

export type AccentTokens = {
  accent: string;
  accentInk: string;
  onAccent: string;
  accentDeep: string;
  accentSoft: string;
  accentLine: string;
};

export type SchemeTokens = PaperTokens & AccentTokens & { shadow: string; shadowLift: string };

type PresetPaper = { light: PaperTokens; dark: PaperTokens; accent: string; shadowTint: string };

export const PRESET_PAPERS: Record<string, PresetPaper> = {
  bluebell: {
    accent: "#2f5fb5",
    shadowTint: "40 70 140",
    light: {
      page: "#eef3fb", check: "rgb(90 130 210 / 0.14)", card: "#fcfdff", line: "#d8e2f2",
      lineStrong: "#b8c9e6", controlLine: "#5f7396", field: "#f5f8fe", rule: "#d6e3f4",
      margin: "#9fb6e8", ink: "#22304a", inkSoft: "#44536e", inkMuted: "#5e6d88",
      tape: "#a9c2f0",
    },
    dark: {
      page: "#18202c", check: "rgb(130 170 240 / 0.07)", card: "#222c3b", line: "#334055",
      lineStrong: "#475a76", controlLine: "#8ea3c4", field: "#1d2634", rule: "rgb(150 180 225 / 0.15)",
      margin: "rgb(130 170 240 / 0.45)", ink: "#eaf0fb", inkSoft: "#c3cee2", inkMuted: "#97a6c0",
      tape: "#6f8fcb",
    },
  },
  meadow: {
    accent: "#3a7a4c",
    shadowTint: "50 110 60",
    light: {
      page: "#f0f6ec", check: "rgb(90 160 100 / 0.14)", card: "#fdfffb", line: "#dbe8d3",
      lineStrong: "#bdd4b0", controlLine: "#5f7a5a", field: "#f6faf3", rule: "#d6e6d2",
      margin: "#a6cf9d", ink: "#26382b", inkSoft: "#46594a", inkMuted: "#5d7160",
      tape: "#b4dcab",
    },
    dark: {
      page: "#18211b", check: "rgb(140 210 150 / 0.06)", card: "#223028", line: "#344a3b",
      lineStrong: "#486354", controlLine: "#8fb09a", field: "#1c271f", rule: "rgb(160 215 175 / 0.14)",
      margin: "rgb(140 210 150 / 0.4)", ink: "#eaf6ec", inkSoft: "#c2d8c8", inkMuted: "#95b09c",
      tape: "#6aa87a",
    },
  },
  marmalade: {
    accent: "#c25a12",
    shadowTint: "150 90 30",
    light: {
      page: "#fff3e0", check: "rgb(235 150 60 / 0.15)", card: "#fffcf5", line: "#f1e0c2",
      lineStrong: "#e3c999", controlLine: "#8f6a3a", field: "#fff8ec", rule: "#f1e2c0",
      margin: "#f0b06a", ink: "#3f2d17", inkSoft: "#665035", inkMuted: "#7d6644",
      tape: "#f6c37e",
    },
    dark: {
      page: "#231b12", check: "rgb(255 180 100 / 0.06)", card: "#30261a", line: "#493a28",
      lineStrong: "#614d35", controlLine: "#b9996d", field: "#2a2116", rule: "rgb(230 195 140 / 0.14)",
      margin: "rgb(255 180 100 / 0.4)", ink: "#faf0e0", inkSoft: "#dcc9a8", inkMuted: "#b09a76",
      tape: "#c28a45",
    },
  },
  lilac: {
    accent: "#7a46c4",
    shadowTint: "100 60 160",
    light: {
      page: "#f5f0fb", check: "rgb(150 100 220 / 0.13)", card: "#fefcff", line: "#e5dbf3",
      lineStrong: "#cebce8", controlLine: "#77608f", field: "#faf6fe", rule: "#e2d9f2",
      margin: "#c4a4ec", ink: "#33284a", inkSoft: "#554768", inkMuted: "#6c5e80",
      tape: "#d2b8f2",
    },
    dark: {
      page: "#1e1826", check: "rgb(190 150 255 / 0.06)", card: "#2a2234", line: "#3f3450",
      lineStrong: "#554768", controlLine: "#a893c4", field: "#241d2d", rule: "rgb(200 175 240 / 0.14)",
      margin: "rgb(190 150 255 / 0.4)", ink: "#f3ecfb", inkSoft: "#d3c5e6", inkMuted: "#a899bd",
      tape: "#8e6ec2",
    },
  },
};

/** Every key an owner can choose, Gingham first. */
export const THEME_PRESET_KEYS: readonly string[] = [DEFAULT_PRESET, ...Object.keys(PRESET_PAPERS)];

export function isPresetKey(value: unknown): value is string {
  return typeof value === "string" && THEME_PRESET_KEYS.includes(value);
}

/** The surfaces accent colours are checked against, per scheme. Gingham's own. */
const GINGHAM_SURFACES = {
  light: { page: "#fff3f5", card: "#fffdfa" },
  dark: { page: "#241a20", card: "#30242a" },
} as const;

/* ---------------------------- colour maths ---------------------------- */

/** Accept `#rgb` or `#rrggbb`, with or without the hash; return lowercase `#rrggbb` or null. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
  return `#${digits.toLowerCase()}`;
}

function toRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function fromRgb([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

/** Relative luminance per WCAG 2.x. */
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return fromRgb([channel(0) * 255, channel(8) * 255, channel(4) * 255]);
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/** Walk lightness in one direction until `ok` holds; the extremes are black and white, which always do. */
function walk(h: number, s: number, from: number, direction: 1 | -1, ok: (hex: string) => boolean): string {
  for (let l = from; l >= 0 && l <= 1; l += direction * 0.005) {
    const candidate = fromHsl(h, s, l);
    if (ok(candidate)) return candidate;
  }
  return direction === 1 ? "#ffffff" : "#000000";
}

/**
 * Turn any colour into a full, readable accent for one colour scheme. The hue the
 * owner picked is kept; lightness is moved until every pairing that carries text
 * or a control clears WCAG AA (4.5:1 for text, which includes the accent when it is link text).
 * `adjusted` says whether the colour had to move.
 */
export function deriveAccent(
  hex: string,
  scheme: ThemeName,
  surfaces: { page: string; card: string; inkSoft?: string; inkMuted?: string } = GINGHAM_SURFACES[scheme],
): AccentTokens & { adjusted: boolean } {
  const [h, s0, l0] = toHsl(normalizeHex(hex) as string);
  const s = clamp(s0, 0.3, 0.9);
  // Selected cards, chips and mentions put secondary and muted text on the soft
  // fill, so the fill moves (lighter on light paper, darker on dark) until both
  // clear 4.5:1. A fill that already does is left exactly as it was.
  const textFits = (fill: string) =>
    [surfaces.inkSoft, surfaces.inkMuted].every((ink) => !ink || contrastRatio(ink, fill) >= 4.5);

  if (scheme === "light") {
    const onAccent = "#ffffff";
    const fits = (c: string) => contrastRatio(c, onAccent) >= 4.5 && contrastRatio(c, surfaces.card) >= 4.5;
    const given = normalizeHex(hex) as string;
    const accent = fits(given) ? given : walk(h, s, Math.min(l0, 0.62), -1, fits);
    const softHue = clamp(s, 0.4, 0.85);
    const accentSoft = walk(h, softHue, 0.93, 1, textFits);
    const accentLine = fromHsl(h, clamp(s, 0.35, 0.8), 0.79);
    const accentInk = walk(h, s, toHsl(accent)[2], -1, (c) =>
      contrastRatio(c, accentSoft) >= 4.5 && contrastRatio(c, surfaces.card) >= 4.5 && contrastRatio(c, surfaces.page) >= 4.5,
    );
    return { accent, accentInk, onAccent, accentDeep: accentInk, accentSoft, accentLine, adjusted: accent !== normalizeHex(hex) };
  }

  const onAccent = fromHsl(h, clamp(s, 0.2, 0.5), 0.12);
  // On dark paper the accent is also the colour of link text, so it has to clear the
  // text bar against the card, not only the 3:1 a fill needs.
  const fits = (c: string) => contrastRatio(c, onAccent) >= 4.5 && contrastRatio(c, surfaces.card) >= 4.5;
  const given = normalizeHex(hex) as string;
  const accent = fits(given) ? given : walk(h, s, Math.max(l0, 0.5), 1, fits);
  const softSat = clamp(s, 0.2, 0.5);
  const accentSoft = walk(h, softSat, 0.2, -1, textFits);
  const accentLine = fromHsl(h, clamp(s, 0.2, 0.5), 0.33);
  const accentInk = walk(h, s, toHsl(accent)[2], 1, (c) =>
    contrastRatio(c, accentSoft) >= 4.5 && contrastRatio(c, surfaces.card) >= 4.5 && contrastRatio(c, surfaces.page) >= 4.5,
  );
  const accentDeep = fromHsl(h, clamp(s, 0.3, 0.7), clamp(toHsl(accent)[2] - 0.15, 0.3, 0.7));
  return { accent, accentInk, onAccent, accentDeep, accentSoft, accentLine, adjusted: accent !== normalizeHex(hex) };
}

/* ----------------------------- resolution ----------------------------- */

export type ThemeSettings = { preset: string | null; accent: string | null };

export type ResolvedTheme = {
  light: SchemeTokens;
  dark: SchemeTokens;
  /** True when the owner's accent had to be moved to stay readable in either scheme. */
  adjusted: boolean;
};

/** `null` means "leave the stylesheet alone": Gingham, no accent. */
export function isDefaultTheme(settings: ThemeSettings): boolean {
  return (!settings.preset || settings.preset === DEFAULT_PRESET) && !normalizeHex(settings.accent);
}

const GINGHAM_PAPER: PresetPaper = {
  accent: "#cc3456",
  shadowTint: "160 40 70",
  light: {
    page: "#fff3f5", check: "rgb(236 118 148 / 0.15)", card: "#fffdfa", line: "#f1dae0",
    lineStrong: "#e4bcc6", controlLine: "#9c6675", field: "#fff8f8", rule: "#d6e3f4",
    margin: "#f3a3b4", ink: "#3d2a30", inkSoft: "#674d55", inkMuted: "#7d5f68",
    tape: "#f6a6ba",
  },
  dark: {
    page: "#241a20", check: "rgb(255 140 170 / 0.07)", card: "#30242a", line: "#46343c",
    lineStrong: "#5c4650", controlLine: "#b28e99", field: "#2a2025", rule: "rgb(150 180 225 / 0.15)",
    margin: "rgb(255 140 165 / 0.45)", ink: "#f8eaee", inkSoft: "#dbc2c9", inkMuted: "#ae939b",
    tape: "#f6a6ba",
  },
};

function accentOnly({ accent, accentInk, onAccent, accentDeep, accentSoft, accentLine }: AccentTokens): AccentTokens {
  return { accent, accentInk, onAccent, accentDeep, accentSoft, accentLine };
}

function scheme(paper: PaperTokens, accent: AccentTokens, shadowTint: string | null): SchemeTokens {
  return {
    ...paper,
    ...accent,
    shadow: shadowTint
      ? `0 1px 2px rgb(${shadowTint} / 0.06), 0 14px 26px -18px rgb(${shadowTint} / 0.4)`
      : "0 14px 26px -18px rgb(0 0 0 / 0.7)",
    shadowLift: shadowTint
      ? `0 18px 32px -20px rgb(${shadowTint} / 0.5)`
      : "0 18px 32px -18px rgb(0 0 0 / 0.8)",
  };
}

/** The full token set for a loop, or null when it should look like the stylesheet's own Gingham. */
export function resolveTheme(settings: ThemeSettings): ResolvedTheme | null {
  if (isDefaultTheme(settings)) return null;

  const key = isPresetKey(settings.preset) ? settings.preset : DEFAULT_PRESET;
  const paper = key === DEFAULT_PRESET ? GINGHAM_PAPER : PRESET_PAPERS[key];
  const seed = normalizeHex(settings.accent) ?? paper.accent;

  const light = deriveAccent(seed, "light", { page: paper.light.page, card: paper.light.card, inkSoft: paper.light.inkSoft, inkMuted: paper.light.inkMuted });
  const dark = deriveAccent(seed, "dark", { page: paper.dark.page, card: paper.dark.card, inkSoft: paper.dark.inkSoft, inkMuted: paper.dark.inkMuted });

  // Every accent, a preset's own seed or the owner's pick, goes through the same
  // derivation, so the readability guarantees are one code path.
  return {
    light: scheme(paper.light, accentOnly(light), paper.shadowTint),
    dark: scheme(paper.dark, accentOnly(dark), null),
    // Only the light result counts: dark paper always lifts an accent, by design,
    // and a preset's own seed is a design choice, not something to apologise for.
    adjusted: Boolean(normalizeHex(settings.accent)) && light.adjusted,
  };
}

const CSS_NAMES: Record<keyof SchemeTokens, string> = {
  page: "--page", check: "--check", card: "--card", line: "--line", lineStrong: "--line-strong",
  controlLine: "--control-line", field: "--field", rule: "--rule", margin: "--margin",
  ink: "--ink", inkSoft: "--ink-soft", inkMuted: "--ink-muted", tape: "--tape",
  accent: "--accent", accentInk: "--accent-ink", onAccent: "--on-accent", accentDeep: "--accent-deep",
  accentSoft: "--accent-soft", accentLine: "--accent-line", shadow: "--shadow", shadowLift: "--shadow-lift",
};

/** One scheme's tokens as CSS custom properties, for a style attribute or a stylesheet. */
export function cssVars(tokens: SchemeTokens): Record<string, string> {
  return Object.fromEntries(
    (Object.keys(CSS_NAMES) as Array<keyof SchemeTokens>).map((key) => [CSS_NAMES[key], tokens[key]]),
  );
}

function declarations(tokens: SchemeTokens): string {
  return Object.entries(cssVars(tokens))
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
}

/**
 * Gingham Picnic as tokens, mirroring `globals.css`. Nothing renders from this:
 * the stylesheet is the source of truth for a default loop. It exists so the
 * settings preview can draw the original beside the alternatives.
 */
export const GINGHAM_RESOLVED: ResolvedTheme = {
  adjusted: false,
  light: scheme(GINGHAM_PAPER.light, {
    accent: "#cc3456", accentInk: "#9e2440", onAccent: "#ffffff", accentDeep: "#9e2440",
    accentSoft: "#fde4e9", accentLine: "#f3b1bf",
  }, GINGHAM_PAPER.shadowTint),
  dark: scheme(GINGHAM_PAPER.dark, {
    accent: "#ff8ba4", accentInk: "#ffb0c2", onAccent: "#2a1219", accentDeep: "#c45a74",
    accentSoft: "#472833", accentLine: "#7a3c4e",
  }, null),
};

/** What the loop would look like with these settings, default included. */
export function previewTheme(settings: ThemeSettings): ResolvedTheme {
  return resolveTheme(settings) ?? GINGHAM_RESOLVED;
}

/**
 * The stylesheet a themed loop adds on top of Gingham. Every value is a colour or
 * shadow this module produced from a validated key and a validated hex, so the
 * string is safe to inline.
 */
export function themeCss(resolved: ResolvedTheme | null): string {
  if (!resolved) return "";
  return `html[data-theme="light"]{${declarations(resolved.light)}}html[data-theme="dark"]{${declarations(resolved.dark)}}`;
}

/**
 * The paper a round prints on: the loop's light scheme with the page and card gone
 * white, no gingham check and no shadows, so a dark screen or a tinted preset never
 * costs anyone ink. Scoped to `.print-sheet`, so it never touches the rest of the page.
 */
export function printThemeCss(resolved: ResolvedTheme | null): string {
  const light = (resolved ?? GINGHAM_RESOLVED).light;
  const paper: SchemeTokens = {
    ...light,
    page: "#ffffff",
    card: "#ffffff",
    field: "#ffffff",
    check: "transparent",
    shadow: "none",
    shadowLift: "none",
  };
  return `.print-sheet{${declarations(paper)}}`;
}

/* ------------------------------- email -------------------------------- */

/** What an email needs of a theme: light only, inline-style friendly. */
export type EmailPalette = {
  page: string;
  check: string;
  card: string;
  line: string;
  lineStrong: string;
  ink: string;
  soft: string;
  muted: string;
  accent: string;
  onAccent: string;
  tape: string;
  shadow: string;
};

export const GINGHAM_EMAIL: EmailPalette = {
  page: "#fff3f5",
  check: "rgba(236,118,148,.15)",
  card: "#fffdfa",
  line: "#f1dae0",
  lineStrong: "#e4bcc6",
  ink: "#3d2a30",
  soft: "#674d55",
  muted: "#86676f",
  accent: "#cc3456",
  onAccent: "#ffffff",
  tape: "#f6a6ba",
  shadow: "0 14px 26px -18px rgba(160,40,70,.4)",
};

function emailRgba(color: string): string {
  const match = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(color);
  return match ? `rgba(${match[1]},${match[2]},${match[3]},${match[4]})` : color;
}

export function emailPalette(settings: ThemeSettings): EmailPalette {
  const resolved = resolveTheme(settings);
  if (!resolved) return GINGHAM_EMAIL;
  const { light } = resolved;
  const tint = /rgb\((\d+ \d+ \d+) \//.exec(light.shadow)?.[1].replace(/ /g, ",") ?? "160,40,70";
  return {
    page: light.page,
    check: emailRgba(light.check),
    card: light.card,
    line: light.line,
    lineStrong: light.lineStrong,
    ink: light.ink,
    soft: light.inkSoft,
    muted: light.inkMuted,
    accent: light.accent,
    onAccent: light.onAccent,
    tape: light.tape,
    shadow: `0 14px 26px -18px rgba(${tint},.4)`,
  };
}
