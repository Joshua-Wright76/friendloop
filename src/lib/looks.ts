import { isCharmKey } from "./stickers.ts";

/**
 * The second set of things a loop and its people can choose: words (a motto, a
 * sign-off, a line per round), marks (a seal or postmark, a divider, a send
 * celebration, a round's cover), and things people stick or sign. Everything here is
 * either a key into one of these tables or text cleaned to a single short line, so
 * nothing a person types ever reaches a stylesheet or an attribute unescaped.
 */

/* --------------------------------- words --------------------------------- */

export const MOTTO_MAX = 60;
export const SIGN_OFF_MAX = 80;
export const STATUS_LINE_MAX = 60;

/**
 * One short line, or null when nothing is left: newlines and runs of spaces fold to
 * one space, control characters go, and the length counts characters as people do
 * (an emoji is one), so a cut never splits one in half.
 */
export function cleanLine(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const folded = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  const line = [...folded].slice(0, max).join("").trim();
  return line ? line : null;
}

/* -------------------------------- the seal ------------------------------- */

export const SEAL_STYLES: readonly string[] = ["wax", "postmark"];

export function isSealStyle(value: unknown): value is string {
  return typeof value === "string" && SEAL_STYLES.includes(value);
}

export const DEFAULT_WAX = "cherry";

/** Each wax: its body, a darker edge where it pools, and a highlight where light catches it. */
export const WAX_COLORS: Record<string, { body: string; deep: string; shine: string }> = {
  [DEFAULT_WAX]: { body: "#b3243b", deep: "#7a1426", shine: "#e46a7c" },
  moss: { body: "#4d7a38", deep: "#2f5221", shine: "#8fbf72" },
  midnight: { body: "#2e4a7d", deep: "#1a2d52", shine: "#7194cc" },
  honey: { body: "#c4851a", deep: "#8a5a0c", shine: "#f2c062" },
  plum: { body: "#77388c", deep: "#4c1f5c", shine: "#b77ccb" },
  ink: { body: "#2c2629", deep: "#141113", shine: "#6d6368" },
};

export const WAX_COLOR_KEYS: readonly string[] = Object.keys(WAX_COLORS);

export function isWaxColor(value: unknown): value is string {
  return typeof value === "string" && WAX_COLOR_KEYS.includes(value);
}

/* ------------------------------- dividers -------------------------------- */

/** Null is the stitches every loop has always had. */
export const DIVIDER_KEYS: readonly string[] = ["ricrac", "lace", "vine", "ticket", "pinking"];

export function isDividerKey(value: unknown): value is string {
  return typeof value === "string" && DIVIDER_KEYS.includes(value);
}

/* ----------------------------- celebrations ------------------------------ */

/** Null is the sent stamp alone, as before. */
export const CELEBRATION_KEYS: readonly string[] = ["confetti", "petals", "stars", "hop", "envelope"];

export function isCelebrationKey(value: unknown): value is string {
  return typeof value === "string" && CELEBRATION_KEYS.includes(value);
}

/* ---------------------------- the owner's marks --------------------------- */

/**
 * What an owner adds to every round: a motto and a sign-off, a seal or postmark
 * (with its wax), a divider and a send celebration. Null in every place is the round
 * as it has always been.
 */
export type LoopMarks = {
  motto: string | null;
  signOff: string | null;
  sealStyle: string | null;
  sealColor: string | null;
  divider: string | null;
  celebration: string | null;
};

export const NO_MARKS: LoopMarks = { motto: null, signOff: null, sealStyle: null, sealColor: null, divider: null, celebration: null };

/**
 * A loop's marks as they're safe to show: text cleaned again on the way out, and a
 * key that isn't one of ours read as no choice at all, so a bad row can't reach a
 * class name or an image address.
 */
export function marksOf(group: Partial<LoopMarks>): LoopMarks {
  return {
    motto: cleanLine(group.motto, MOTTO_MAX),
    signOff: cleanLine(group.signOff, SIGN_OFF_MAX),
    sealStyle: isSealStyle(group.sealStyle) ? group.sealStyle : null,
    sealColor: isWaxColor(group.sealColor) && group.sealColor !== DEFAULT_WAX ? group.sealColor : null,
    divider: isDividerKey(group.divider) ? group.divider : null,
    celebration: isCelebrationKey(group.celebration) ? group.celebration : null,
  };
}

/** Left out means "leave it"; empty means none (or the original, for the wax). */
export type MarksInput = Partial<Record<keyof LoopMarks, string>>;

const MARK_KEYS: Array<{ input: Exclude<keyof LoopMarks, "motto" | "signOff">; isKey: (value: unknown) => boolean; original?: string }> = [
  { input: "sealStyle", isKey: isSealStyle },
  { input: "sealColor", isKey: isWaxColor, original: DEFAULT_WAX },
  { input: "divider", isKey: isDividerKey },
  { input: "celebration", isKey: isCelebrationKey },
];

/**
 * The owner's marks as columns, or the first one that isn't ours. Words are cleaned
 * to one short line (blank is none); a key must be from its table, and anything else
 * is refused whole rather than stored.
 */
export function marksColumns(input: MarksInput): { ok: true; columns: Partial<LoopMarks> } | { ok: false; error: keyof LoopMarks } {
  const columns: Partial<LoopMarks> = {};
  if (input.motto !== undefined) columns.motto = cleanLine(input.motto, MOTTO_MAX);
  if (input.signOff !== undefined) columns.signOff = cleanLine(input.signOff, SIGN_OFF_MAX);
  for (const mark of MARK_KEYS) {
    const value = input[mark.input];
    if (value === undefined) continue;
    if (value !== "" && !mark.isKey(value)) return { ok: false, error: mark.input };
    columns[mark.input] = value === "" || value === mark.original ? null : value;
  }
  return { ok: true, columns };
}

/* ------------------------------ round covers ----------------------------- */

/** A cover's tint and the ink its name is written in, fixed so email can carry them too. */
export const COVER_TINTS: Record<string, { tint: string; ink: string }> = {
  moss: { tint: "#dcebcf", ink: "#3a6229" },
  sky: { tint: "#dbe7fa", ink: "#2c4a7f" },
  butter: { tint: "#fdf0c6", ink: "#7a520a" },
  plum: { tint: "#ecdcf2", ink: "#632b76" },
  peach: { tint: "#fde0d4", ink: "#963a25" },
  rose: { tint: "#fde4e9", ink: "#9e2440" },
};

export const COVER_TINT_KEYS: readonly string[] = Object.keys(COVER_TINTS);

export function isCoverTint(value: unknown): value is string {
  return typeof value === "string" && COVER_TINT_KEYS.includes(value);
}

/** A cover's sticker, or one slapped on an answer: any drawing from the sticker sheet. */
export const isStickerKey = isCharmKey;

/* ------------------------------- signatures ------------------------------ */

/** The board a signature is drawn on. Any pad scales its strokes onto it. */
export const SIGNATURE_BOARD = { width: 600, height: 200 } as const;
const MAX_STROKES = 60;
const MAX_POINTS = 2400;

/**
 * Pen strokes from a browser, or null when there is nothing to sign with. Each
 * stroke is a flat list of x,y pairs; values are rounded and kept on the board, and
 * anything malformed or too large is refused whole rather than half-kept.
 */
export function parseSignature(value: unknown): number[][] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STROKES) return null;
  const strokes: number[][] = [];
  let points = 0;
  for (const stroke of value) {
    if (!Array.isArray(stroke) || stroke.length < 2 || stroke.length % 2 !== 0) return null;
    if (!stroke.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    points += stroke.length / 2;
    if (points > MAX_POINTS) return null;
    strokes.push(
      stroke.map((n, index) => {
        const limit = index % 2 === 0 ? SIGNATURE_BOARD.width : SIGNATURE_BOARD.height;
        return Math.min(limit, Math.max(0, Math.round(n)));
      }),
    );
  }
  return strokes;
}

/** An SVG path for the strokes. A single tap becomes a dot the round cap can show. */
export function signaturePath(strokes: number[][]): string {
  return strokes
    .map((stroke) => {
      const [x, y, ...rest] = stroke;
      if (rest.length === 0) return `M${x} ${y}h0.1`;
      const pairs: string[] = [];
      for (let i = 0; i < rest.length; i += 2) pairs.push(`${rest[i]} ${rest[i + 1]}`);
      return `M${x} ${y}L${pairs.join(" ")}`;
    })
    .join("");
}

/** The box the ink actually covers, padded for the pen's width: a signature's viewBox. */
export function signatureBox(strokes: number[][], pad = 8): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (let i = 0; i < stroke.length; i += 2) {
      minX = Math.min(minX, stroke[i]);
      maxX = Math.max(maxX, stroke[i]);
      minY = Math.min(minY, stroke[i + 1]);
      maxY = Math.max(maxY, stroke[i + 1]);
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: SIGNATURE_BOARD.width, height: SIGNATURE_BOARD.height };
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

/* ------------------------------- scrapbook ------------------------------- */

/** How many stickers one person may stick around one round. */
export const SCRAPBOOK_PER_ROUND = 3;
export const MAX_TILT = 16;

export type StickerPlacement = { side: "left" | "right"; offset: number; tilt: number };

/** A placement from a browser, kept inside the answer's margins, or null if it isn't one. */
export function cleanPlacement(value: unknown): StickerPlacement | null {
  if (!value || typeof value !== "object") return null;
  const { side, offset, tilt } = value as Record<string, unknown>;
  if (side !== "left" && side !== "right") return null;
  if (typeof offset !== "number" || !Number.isFinite(offset)) return null;
  if (typeof tilt !== "number" || !Number.isFinite(tilt)) return null;
  return {
    side,
    offset: Math.min(100, Math.max(0, Math.round(offset))),
    tilt: Math.min(MAX_TILT, Math.max(-MAX_TILT, Math.round(tilt))),
  };
}
