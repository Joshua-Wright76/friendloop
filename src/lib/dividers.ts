import { isDividerKey } from "./looks.ts";
import { DEFAULT_PRESET, isPresetKey, previewTheme, THEME_PRESET_KEYS, type SchemeTokens } from "./theme.ts";

/**
 * The line between one answer and the next. Null is the stitches every loop has
 * always had and adds nothing; any other divider is a small SVG tile in the loop's
 * own colours, laid along the top edge of each answer with `border-image`, so choosing
 * one moves nothing on the page. Colours come from validated tokens, keys from
 * `DIVIDER_KEYS`, so every value here is safe to inline.
 */

type Colors = Pick<SchemeTokens, "accent" | "accentInk" | "accentLine" | "accentSoft" | "line" | "lineStrong" | "card" | "page">;

type Drawing = {
  width: number;
  height: number;
  /** How much of each end is a fixed corner rather than repeated (the ticket's notches). */
  ends?: number;
  art: (c: Colors) => string;
  /** The repeating middle alone, for email, where nothing can reach the card's edges. */
  emailArt?: (c: Colors) => string;
  emailWidth?: number;
};

const DRAWINGS: Record<string, Drawing> = {
  // The wavy trim off a picnic blanket.
  ricrac: {
    width: 22,
    height: 12,
    art: (c) => `<path d='M0 6Q5.5-1 11 6T22 6' fill='none' stroke='${c.accent}' stroke-width='3' stroke-linecap='round'/>`,
  },
  // A doily's edge: scallops with a punched hole in each.
  lace: {
    width: 20,
    height: 14,
    art: (c) =>
      `<path fill-rule='evenodd' d='M0 1.5H20Q10 17 0 1.5ZM10 5.4a1.8 1.8 0 1 0 0 .01Z' fill='${c.accentSoft}' stroke='${c.accentLine}' stroke-width='1'/>`,
  },
  // A stem with a leaf either side of it.
  vine: {
    width: 56,
    height: 24,
    art: (c) =>
      `<path d='M0 12C14 4 14 4 28 12S42 20 56 12' fill='none' stroke='${c.accentLine}' stroke-width='1.8'/><path d='M12 7.6c-1-5 3-7.6 7-7.4-.6 4.4-3.4 6.8-7 7.4zM40 16.4c1 5-3 7.6-7 7.4.6-4.4 3.4-6.8 7-7.4z' fill='${c.accent}' opacity='.85'/>`,
  },
  // A tear-off line with a notch punched at each edge of the card.
  ticket: {
    width: 34,
    height: 22,
    ends: 11,
    art: (c) =>
      `<circle cx='0' cy='11' r='10.5' fill='${c.page}' stroke='${c.line}'/><circle cx='34' cy='11' r='10.5' fill='${c.page}' stroke='${c.line}'/><rect x='14' y='10.2' width='6' height='1.6' rx='.8' fill='${c.lineStrong}'/>`,
    emailWidth: 12,
    emailArt: (c) => `<rect x='3' y='10.2' width='6' height='1.6' rx='.8' fill='${c.lineStrong}'/>`,
  },
  // The zigzag edge pinking shears leave on cloth.
  pinking: {
    width: 14,
    height: 10,
    art: (c) => `<path d='M0 0H14V2L7 9 0 2Z' fill='${c.accentSoft}'/><path d='M0 2 7 9 14 2' fill='none' stroke='${c.accentLine}' stroke-width='1.4' stroke-linejoin='round'/>`,
  },
};

function svgUrl(width: number, height: number, inner: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>${inner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** How far a divider reaches past an answer to the card's edges: the card's padding and its border. */
export const CARD_REACH = 21;

/**
 * One divider in one scheme's colours, as a `border-image` value, or "none" for the
 * stitches. Its top edge is the tile, scaled to its own height and centred on the line
 * the stitches drew; a ticket's notches sit `reach` pixels out, at the card's edges.
 */
export function dividerBorder(key: string | null | undefined, tokens: Colors, reach = CARD_REACH): string {
  if (!isDividerKey(key)) return "none";
  const drawing = DRAWINGS[key];
  const { width, height } = drawing;
  const ends = drawing.ends ?? 0;
  const half = height / 2;
  return `${svgUrl(width, height, drawing.art(tokens))} ${height} ${ends} 0 ${ends} / ${height}px ${ends}px 0 ${ends}px / ${half}px ${ends ? reach : 0}px 0 ${ends ? reach : 0}px round`;
}

/** The divider for both schemes, as the custom property the stylesheet reads. */
export function dividerCss(key: string | null | undefined, light: Colors, dark: Colors): string {
  if (!isDividerKey(key)) return "";
  return `html[data-theme="light"]{--divider:${dividerBorder(key, light)}}html[data-theme="dark"]{--divider:${dividerBorder(key, dark)}}`;
}

/* --------------------------------- email --------------------------------- */

/**
 * Email can't use `border-image` or SVG, so each divider also ships as a PNG tile per
 * preset (`scripts/render-email-dividers.mjs`), laid along a row as a repeating
 * background. Its colours are the preset's own, never a custom accent, so the set is
 * finite. A ticket's notches can't reach a card's edges in email: it keeps its tear line.
 */
export type EmailDividerStrip = { path: string; width: number; height: number };

export function emailDividerStrip(divider: string | null | undefined, preset: string | null | undefined): EmailDividerStrip | null {
  if (!isDividerKey(divider)) return null;
  const drawing = DRAWINGS[divider];
  const paper = isPresetKey(preset) ? preset : DEFAULT_PRESET;
  return { path: `/dividers/email/${divider}-${paper}.png`, width: drawing.emailWidth ?? drawing.width, height: drawing.height };
}

/** Every strip email can ask for, with the SVG to draw it from. For the render script. */
export function emailDividerStrips(): Array<EmailDividerStrip & { svg: string }> {
  return Object.keys(DRAWINGS).flatMap((divider) =>
    THEME_PRESET_KEYS.map((preset) => {
      const { light } = previewTheme({ preset, accent: null });
      const drawing = DRAWINGS[divider];
      const strip = emailDividerStrip(divider, preset)!;
      const art = (drawing.emailArt ?? drawing.art)(light);
      return { ...strip, svg: `<svg xmlns='http://www.w3.org/2000/svg' width='${strip.width}' height='${strip.height}' viewBox='0 0 ${strip.width} ${strip.height}'>${art}</svg>` };
    }),
  );
}
