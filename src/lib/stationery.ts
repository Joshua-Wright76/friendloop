import { DEFAULT_MASCOT, isMascotKey, stickerSrc } from "./stickers.ts";
import { DEFAULT_PRESET, isPresetKey, previewTheme, resolveTheme, themeCss, THEME_PRESET_KEYS, type SchemeTokens, type ThemeName } from "./theme.ts";

/**
 * What a loop's owner can dress it in besides colour: the page behind everything,
 * a pack of paper textures, a pack of washi tape, and a mascot. Each of them is only
 * ever a set of custom properties the stylesheet already reads with a fallback, so a
 * loop that chose nothing gets no CSS at all and renders exactly as it always did.
 * Every value here comes from these tables, never from input, so it is safe to inline.
 */

export type StationerySettings = {
  preset: string | null;
  accent: string | null;
  background?: string | null;
  paperPack?: string | null;
  tapePack?: string | null;
  mascot?: string | null;
};

/** The columns a loop keeps its stationery in. */
export type StationeryColumns = {
  themePreset: string | null;
  themeAccent: string | null;
  themeBackground: string | null;
  themePaperPack: string | null;
  themeTapePack: string | null;
  themeMascot: string | null;
};

export function stationeryOf(group: StationeryColumns): StationerySettings {
  return {
    preset: group.themePreset,
    accent: group.themeAccent,
    background: group.themeBackground,
    paperPack: group.themePaperPack,
    tapePack: group.themeTapePack,
    mascot: group.themeMascot,
  };
}

function svgUrl(width: number, height: number, inner: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>${inner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/* ---------------------------- the page itself ---------------------------- */

export const DEFAULT_BACKGROUND = "gingham";

type Pattern = { width: number; height: number; paint: "fill" | "stroke"; art: string };

const rotated = (count: number, shape: (angle: number) => string) =>
  Array.from({ length: count }, (_, index) => shape((index * 360) / count)).join("");
const flower = (x: number, y: number) =>
  rotated(6, (angle) => `<ellipse cx='${x}' cy='${y - 7.5}' rx='3.8' ry='5.8' transform='rotate(${angle} ${x} ${y})'/>`);
const heart = (x: number, y: number) =>
  `<path transform='translate(${x} ${y})' d='M0 7C-7 2-9-1-9-4a4.7 4.7 0 0 1 9-2 4.7 4.7 0 0 1 9 2c0 3-2 6-9 11z'/>`;
const sparkle = (x: number, y: number, r: number) =>
  `<path d='M${x} ${y - r}Q${x + r * 0.16} ${y - r * 0.16} ${x + r} ${y}Q${x + r * 0.16} ${y + r * 0.16} ${x} ${y + r}Q${x - r * 0.16} ${y + r * 0.16} ${x - r} ${y}Q${x - r * 0.16} ${y - r * 0.16} ${x} ${y - r}z'/>`;
const bow = (x: number, y: number) =>
  `<g transform='translate(${x} ${y})'><path d='M0 0C-10-11-17-7-13 3c2 5 8 4 13-3C6 7 12 8 14 3c4-10-3-14-14-3zM0 0l-5 13 6-3 4 4 1-14'/><circle r='3.2'/></g>`;
const cherryPair = (x: number, y: number) =>
  `<g transform='translate(${x} ${y})'><path d='M0-6C-2-15 4-18 10-19M0-6C5-12 10-10 13-5M7-18c6-4 11-1 13 3-6 3-10 1-13-3z'/><circle cx='-2' cy='3' r='7'/><circle cx='13' cy='4' r='7'/></g>`;
const crescent = (x: number, y: number) =>
  `<path transform='translate(${x} ${y})' d='M3-13A14 14 0 1 0 15 9 12 12 0 0 1 3-13z'/>`;
const rainbow = (x: number, y: number) =>
  `<g transform='translate(${x} ${y})'><path d='M-12 8a12 12 0 0 1 24 0M-8 8a8 8 0 0 1 16 0M-4 8a4 4 0 0 1 8 0'/></g>`;

const PATTERNS: Record<string, Pattern> = {
  dots: { width: 40, height: 40, paint: "fill", art: "<circle cx='10' cy='10' r='5.5'/><circle cx='30' cy='30' r='5.5'/>" },
  deckchair: { width: 56, height: 56, paint: "fill", art: "<rect width='28' height='56'/>" },
  graph: { width: 26, height: 26, paint: "stroke", art: "<path stroke-width='1.5' d='M25.250 0v26M0 25.250h26'/>" },
  scallops: { width: 44, height: 44, paint: "stroke", art: "<path stroke-width='2.5' d='M0 22a22 22 0 0 1 44 0M-22 44a22 22 0 0 1 44 0M22 44a22 22 0 0 1 44 0'/>" },
  hearts: { width: 68, height: 68, paint: "fill", art: `${heart(17, 17)}${heart(51, 51)}` },
  daisies: { width: 76, height: 76, paint: "fill", art: `${flower(19, 19)}${flower(57, 57)}` },
  stars: { width: 72, height: 72, paint: "fill", art: `${sparkle(18, 20, 11)}${sparkle(54, 52, 7)}<circle cx='52' cy='16' r='2'/><circle cx='16' cy='56' r='2.5'/>` },
  confetti: {
    width: 84,
    height: 84,
    paint: "fill",
    art: "<rect x='10' y='12' width='14' height='5' rx='2.5' transform='rotate(24 17 14)'/><circle cx='52' cy='14' r='3.5'/><rect x='62' y='32' width='14' height='5' rx='2.5' transform='rotate(-38 69 34)'/><rect x='30' y='44' width='14' height='5' rx='2.5' transform='rotate(70 37 46)'/><circle cx='12' cy='56' r='3'/><rect x='52' y='66' width='14' height='5' rx='2.5' transform='rotate(14 59 68)'/><circle cx='30' cy='74' r='2.5'/>",
  },
  checkerboard: {
    width: 48,
    height: 48,
    paint: "fill",
    art: "<rect width='24' height='24'/><rect x='24' y='24' width='24' height='24'/>",
  },
  crosshatch: {
    width: 32,
    height: 32,
    paint: "stroke",
    art: "<path stroke-width='1.6' d='M-8 8L8-8M0 32L32 0M24 40L40 24M-8 24L8 40M0 0L32 32M24-8L40 8'/>",
  },
  bows: { width: 84, height: 84, paint: "stroke", art: `${bow(21, 20)}${bow(63, 62)}` },
  cherries: { width: 84, height: 84, paint: "stroke", art: `${cherryPair(20, 26)}${cherryPair(62, 68)}` },
  moons: { width: 84, height: 84, paint: "fill", art: `${crescent(14, 20)}${sparkle(62, 54, 8)}<circle cx='60' cy='14' r='2.5'/><circle cx='18' cy='65' r='2'/>` },
  rainbows: { width: 76, height: 68, paint: "stroke", art: `${rainbow(20, 18)}${rainbow(58, 52)}` },
};

export const BACKGROUND_KEYS: readonly string[] = [DEFAULT_BACKGROUND, ...Object.keys(PATTERNS)];

export function isBackgroundKey(value: unknown): value is string {
  return typeof value === "string" && BACKGROUND_KEYS.includes(value);
}

/**
 * How strong a pattern may print. Where gingham's stripes cross, the check is laid on
 * the page twice; a single layer this strong lands on exactly that colour, so every
 * pattern keeps the readability the accent was derived against (see `busiestPage`).
 */
export function motifOf(check: string): { color: string; opacity: number } {
  const [r, g, b, a] = check.match(/[\d.]+/g)!.map(Number);
  return { color: `rgb(${r},${g},${b})`, opacity: Number((1 - (1 - a) ** 2).toFixed(4)) };
}

/** One background in one scheme's colours: `image` and `size` for the page, or for a tile showing it. */
export function pageLayers(key: string, tokens: Pick<SchemeTokens, "check">): { image: string; size: string } {
  const pattern = PATTERNS[key];
  if (!pattern) {
    const stripe = (direction: string) => `linear-gradient(${direction}${tokens.check} 50%, transparent 0)`;
    return { image: `${stripe("90deg, ")}, ${stripe("")}`, size: "32px 32px" };
  }
  const motif = motifOf(tokens.check);
  const paint = pattern.paint === "fill" ? `fill='${motif.color}'` : `fill='none' stroke='${motif.color}'`;
  return {
    image: svgUrl(pattern.width, pattern.height, `<g ${paint} opacity='${motif.opacity}'>${pattern.art}</g>`),
    size: `${pattern.width}px ${pattern.height}px`,
  };
}

/**
 * Email can't show the SVG patterns, so each one also ships as a PNG tile per preset
 * (`scripts/render-email-patterns.mjs`), drawn on the preset's light page. A pattern's
 * colour comes from the preset's paper alone, never the accent, so the set is finite.
 * Gingham needs no tile: email draws its stripes with gradients, as before.
 */
export type EmailPatternTile = { path: string; width: number; height: number };

export function emailPatternTile(background: string | null | undefined, preset: string | null | undefined): EmailPatternTile | null {
  if (!isBackgroundKey(background) || background === DEFAULT_BACKGROUND) return null;
  const pattern = PATTERNS[background];
  const paper = isPresetKey(preset) ? preset : DEFAULT_PRESET;
  return { path: `/patterns/email/${background}-${paper}.png`, width: pattern.width, height: pattern.height };
}

/** Every tile email can ask for, with what to draw in it. For the render script. */
export function emailPatternTiles(): Array<EmailPatternTile & { page: string; image: string }> {
  return Object.keys(PATTERNS).flatMap((background) =>
    THEME_PRESET_KEYS.map((preset) => {
      const { light } = previewTheme({ preset, accent: null });
      return { ...emailPatternTile(background, preset)!, page: light.page, image: pageLayers(background, light).image };
    }),
  );
}

/* ------------------------------ paper packs ------------------------------ */

export const DEFAULT_PAPER_PACK = "cream";

/** Each surface's own paper, as background layers that end in a comma: the card's colour comes last. */
export type PaperPack = {
  answer: string;
  poll: string;
  music: string;
  note: string;
  /** The red margin down the left of a card; absent keeps it, as a real notebook would. */
  margin?: string;
  /** Rules behind the written words themselves, spaced by their own line height so they always align. */
  answerLines?: boolean;
};

const LINE = "var(--texture-line)";
const DOT = "var(--line-strong)";
const tiled = (image: string, size: string) => `${image} 0 0/${size}`;

const graph = `${tiled(`linear-gradient(${LINE} 1px,transparent 1px)`, "20px 20px")},${tiled(`linear-gradient(90deg,${LINE} 1px,transparent 1px)`, "20px 20px")},`;
const dotGrid = `${tiled(`radial-gradient(circle,${DOT} 1.1px,transparent 1.6px)`, "18px 18px")},`;
const stave = `repeating-linear-gradient(transparent 0 26px,${LINE} 26px 27px,transparent 27px 33px,${LINE} 33px 34px,transparent 34px 40px,${LINE} 40px 41px,transparent 41px 47px,${LINE} 47px 48px,transparent 48px 54px,${LINE} 54px 55px,transparent 55px 78px),`;
const THREAD = `color-mix(in srgb,${LINE} 42%,transparent)`;
const weave = `repeating-linear-gradient(0deg,${THREAD} 0 1px,transparent 1px 3px),repeating-linear-gradient(90deg,${THREAD} 0 1px,transparent 1px 5px),`;
const speckle = `${svgUrl(120, 120, "<g fill='rgb(140,112,84)' opacity='.34'><circle cx='14' cy='22' r='.9'/><circle cx='38' cy='8' r='.6'/><circle cx='66' cy='30' r='1.1'/><circle cx='98' cy='14' r='.7'/><circle cx='22' cy='62' r='.7'/><circle cx='52' cy='74' r='1'/><circle cx='84' cy='58' r='.6'/><circle cx='110' cy='82' r='.9'/><circle cx='12' cy='104' r='1.1'/><circle cx='44' cy='112' r='.6'/><circle cx='76' cy='100' r='.8'/><path d='M28 40l5 2M88 34l4-3M62 92l5-1M104 108l3 3' stroke='rgb(140,112,84)' stroke-width='.7' fill='none'/></g>")} 0 0/120px 120px,`;
const fibres = `${svgUrl(180, 180, "<g fill='none' stroke='rgb(150,124,96)' stroke-width='.8' opacity='.3' stroke-linecap='round'><path d='M10 24q14-8 26 2M66 12q8 12 22 8M122 34q12-6 22 6M24 78q10 10 24 4M92 66q12-10 24-2M148 92q10 8 22 0M12 132q14 6 22-6M70 118q10 12 24 8M124 146q14-8 24 4M44 164q8-8 22-4'/></g>")} 0 0/180px 180px,`;
const grain = `${svgUrl(220, 220, "<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .45 0 0 0 0 .4 0 0 0 0 .38 0 0 0 .34 -.13'/></filter><rect width='220' height='220' filter='url(#g)'/>")} 0 0/220px 220px,`;
const flat = (color: string) => `linear-gradient(${color},${color}),`;
const kraft = flat("rgb(150 110 60 / .08)");
const airmail = "repeating-linear-gradient(-45deg,#d9485f 0 9px,transparent 9px 18px,#3f6fc4 18px 27px,transparent 27px 36px) 0 0/100% 6px no-repeat,";
const perforation = `repeating-linear-gradient(90deg,${DOT} 0 6px,transparent 6px 12px) 0 12px/100% 1.5px no-repeat,`;
const wash = (x: string, y: string) => `radial-gradient(80% 60% at ${x} ${y},var(--accent-soft),transparent 72%),`;
const parchmentShade = "radial-gradient(ellipse at center,transparent 50%,rgb(150 105 55 / .09) 100%),";
const fineWeave = `repeating-linear-gradient(0deg,${THREAD} 0 1px,transparent 1px 4px),repeating-linear-gradient(90deg,${THREAD} 0 1px,transparent 1px 4px),`;
const postage = `${svgUrl(150, 96, "<g fill='none' stroke='rgb(120,100,80)' opacity='.24'><rect x='91' y='10' width='45' height='52' stroke-width='1.5' stroke-dasharray='3 2'/><circle cx='113' cy='34' r='13'/><path d='M102 34h22M113 23v22M29 29h62M25 36h66M31 43h57'/><circle cx='83' cy='35' r='22'/></g>")} 100% 0/150px 96px no-repeat,`;

const NO_MARGIN = "transparent";

export const PAPER_PACKS: Record<string, PaperPack> = {
  [DEFAULT_PAPER_PACK]: { answer: "", poll: "", music: "", note: "" },
  schoolbook: { answer: "", poll: graph, music: stave, note: dotGrid, answerLines: true },
  journal: { answer: dotGrid, poll: graph, music: dotGrid, note: dotGrid, margin: NO_MARGIN },
  recycled: {
    answer: `${speckle}${kraft}`,
    poll: `${perforation}${speckle}${kraft}`,
    music: `${fibres}${kraft}`,
    note: `${fibres}${speckle}${kraft}`,
    margin: NO_MARGIN,
  },
  airmail: {
    answer: `${airmail}${weave}`,
    poll: `${airmail}${dotGrid}`,
    music: `${airmail}${weave}`,
    note: weave,
    margin: NO_MARGIN,
  },
  watercolor: {
    answer: `${grain}${wash("8%", "0%")}`,
    poll: `${grain}${wash("100%", "0%")}`,
    music: `${grain}${wash("50%", "100%")}`,
    note: `${grain}${wash("0%", "100%")}`,
    margin: NO_MARGIN,
  },
  parchment: {
    answer: `${parchmentShade}${speckle}${kraft}`,
    poll: `${parchmentShade}${fibres}${kraft}`,
    music: `${parchmentShade}${grain}${kraft}`,
    note: `${parchmentShade}${fibres}${speckle}${kraft}`,
    margin: NO_MARGIN,
  },
  linen: {
    answer: `${fineWeave}${flat("rgb(170 145 110 / .035)")}`,
    poll: `${fineWeave}${flat("rgb(170 145 110 / .035)")}`,
    music: `${fineWeave}${flat("rgb(170 145 110 / .035)")}`,
    note: `${fineWeave}${flat("rgb(170 145 110 / .035)")}`,
    margin: NO_MARGIN,
  },
  sticky: {
    answer: flat("rgb(255 221 87 / .22)"),
    poll: flat("rgb(246 166 186 / .18)"),
    music: flat("rgb(143 198 232 / .2)"),
    note: flat("rgb(145 220 180 / .2)"),
    margin: NO_MARGIN,
  },
  postcard: {
    answer: `${postage}${fibres}`,
    poll: `${postage}${dotGrid}`,
    music: `${postage}${weave}`,
    note: `${postage}${fibres}`,
    margin: NO_MARGIN,
  },
};

export const PAPER_PACK_KEYS: readonly string[] = Object.keys(PAPER_PACKS);

export function isPaperPackKey(value: unknown): value is string {
  return typeof value === "string" && PAPER_PACK_KEYS.includes(value);
}

/** A pack as custom properties. `initial` is what lets a preview show Plain cream inside a loop wearing something else. */
export function paperVars(key: string): Record<string, string> {
  const pack = PAPER_PACKS[key] ?? PAPER_PACKS[DEFAULT_PAPER_PACK];
  return {
    "--paper-answer": pack.answer || "initial",
    "--paper-poll": pack.poll || "initial",
    "--paper-music": pack.music || "initial",
    "--paper-note": pack.note || "initial",
    "--paper-margin": pack.margin ?? "initial",
    "--answer-lines": pack.answerLines ? `repeating-linear-gradient(transparent 0 calc(1lh - 1px),${LINE} calc(1lh - 1px) 1lh)` : "initial",
    // A writing field keeps its own rules on a clean sheet, whatever the card behind it is doing.
    "--field-wash": pack.answer ? "var(--card)" : "initial",
  };
}

/* ------------------------------- washi tape ------------------------------ */

export const DEFAULT_TAPE_PACK = "picnic";

/** The stylesheet's four tones, each a `background` value. */
export const TAPE_TONES = ["dots", "stripe", "mint", "check"] as const;
type TapeTone = (typeof TAPE_TONES)[number];

const dotted = (dot: string, ground: string) => `radial-gradient(circle,${dot} 1.8px,transparent 2.3px) 0 0/9px 9px,${ground}`;
const candy = (a: string, b: string) => `repeating-linear-gradient(-45deg,${a} 0 5px,${b} 5px 10px)`;
const ticks = (tick: string, ground: string) => `repeating-linear-gradient(90deg,${tick} 0 3px,transparent 3px 11px),${ground}`;
const checked = (check: string, ground: string) => `linear-gradient(90deg,${check} 50%,transparent 0) 0 0/8px 8px,linear-gradient(${check} 50%,transparent 0) 0 0/8px 8px,${ground}`;
const motif = (art: string, ground: string) => `${svgUrl(22, 22, art)} 0 0/22px 22px,${ground}`;
const tinyFlower = (fill: string) => `<g fill='${fill}'>${rotated(5, (angle) => `<ellipse cx='11' cy='6.5' rx='2.4' ry='3.2' transform='rotate(${angle} 11 11)'/>`)}</g><circle cx='11' cy='11' r='2' fill='#ffd24a'/>`;
const tinyStar = (fill: string) => `<g fill='${fill}'>${sparkle(7, 8, 5)}${sparkle(16, 16, 3)}</g>`;
const tinyWave = (stroke: string) => `<path fill='none' stroke='${stroke}' stroke-width='1.8' d='M0 8q5.500-6 11 0t11 0M0 18q5.500-6 11 0t11 0'/>`;
const tinyHeart = (fill: string) => `<g fill='${fill}' transform='translate(11 11) scale(.62)'><path d='M0 7C-7 2-9-1-9-4a4.7 4.7 0 0 1 9-2 4.7 4.7 0 0 1 9 2c0 3-2 6-9 11z'/></g>`;
const tinyLeaf = (fill: string) => `<path fill='${fill}' d='M11 3C4 4 3 12 10 17c7-1 10-8 7-14-2 0-4 0-6 0zM5 19 17 6' stroke='${fill}' stroke-width='1.2'/>`;
const tinyCherry = (fill: string) => `<g fill='${fill}'><circle cx='7' cy='15' r='4.5'/><circle cx='16' cy='16' r='4.5'/></g><path d='M7 11Q7 4 13 3M7 11q5-8 10-4M11 4q5-4 9 0-5 3-9 0z' fill='none' stroke='${fill}' stroke-width='1.4'/>`;
const tinyCitrus = (stroke: string) => `<g fill='none' stroke='${stroke}' stroke-width='1.3'><circle cx='11' cy='11' r='8'/><circle cx='11' cy='11' r='5.5'/><path d='M11 5.5v11M5.5 11h11M7.1 7.1l7.8 7.8M14.9 7.1l-7.8 7.8'/></g>`;
const tinyMushroom = (fill: string) => `<g fill='${fill}'><path d='M3 11a8 8 0 0 1 16 0zM8 11h6l1 8H7z'/></g>`;
const tinyRainbow = (stroke: string) => `<path fill='none' stroke='${stroke}' stroke-width='1.7' d='M2 17a9 9 0 0 1 18 0M5 17a6 6 0 0 1 12 0M8 17a3 3 0 0 1 6 0'/>`;
const tinyBow = (fill: string) => `<g fill='${fill}' transform='translate(11 9) scale(.65)'><path d='M0 0C-10-11-17-7-13 3c2 5 8 4 13-3C6 7 12 8 14 3c4-10-3-14-14-3zM0 0l-5 13 6-3 4 4 1-14'/><circle r='3.2'/></g>`;

export const TAPE_PACKS: Record<string, Record<TapeTone, string> | null> = {
  // The stylesheet's own, so a loop that never chose keeps exactly what it had.
  [DEFAULT_TAPE_PACK]: null,
  garden: {
    dots: motif(tinyFlower("#ffffff"), "#a9dec9"),
    stripe: candy("#b7d99a", "#eaf5d9"),
    mint: motif(tinyFlower("#f6a6ba"), "#fff6df"),
    check: checked("rgb(92 150 90 / .32)", "#eef7e4"),
  },
  seaside: {
    dots: motif(tinyWave("#ffffff"), "#8fc6e8"),
    stripe: candy("#2f5fb5", "#f2f7fe"),
    mint: dotted("#ffffff", "#f3ceaa"),
    check: checked("rgb(47 95 181 / .28)", "#e6f2fb"),
  },
  candy: {
    dots: motif(tinyHeart("#ffffff"), "#f6a6ba"),
    stripe: candy("#ff8fb0", "#fff1f5"),
    mint: dotted("#ffffff", "#b5e6d8"),
    check: ticks("rgb(255 255 255 / .6)", "#ffe28a"),
  },
  starlight: {
    dots: motif(tinyStar("#ffe08a"), "#34407a"),
    stripe: candy("#c9a24a", "#f4e3ae"),
    mint: motif(tinyStar("#ffffff"), "#7a5cc4"),
    check: checked("rgb(255 224 138 / .28)", "#2a3160"),
  },
  kraft: {
    dots: dotted("rgb(255 250 240 / .85)", "#c9a57a"),
    stripe: candy("#c9483f", "#f8efe2"),
    mint: ticks("rgb(120 90 60 / .18)", "#efe2c8"),
    check: checked("rgb(90 70 50 / .22)", "#e4d3b8"),
  },
  fruit: {
    dots: motif(tinyCherry("#ffffff"), "#ed7280"),
    stripe: candy("#f2b84b", "#fff1c9"),
    mint: motif(tinyCitrus("#ffffff"), "#8fc98f"),
    check: checked("rgb(237 114 128 / .25)", "#fff1e8"),
  },
  woodland: {
    dots: motif(tinyLeaf("#ffffff"), "#6f9671"),
    stripe: candy("#8b6548", "#eadcc4"),
    mint: motif(tinyMushroom("#fff4df"), "#bd6e52"),
    check: checked("rgb(75 105 70 / .25)", "#e4ecd8"),
  },
  retro: {
    dots: motif(tinyFlower("#fff0c2"), "#d97941"),
    stripe: candy("#d5aa3c", "#f7e8ae"),
    mint: motif(tinyStar("#fff4d2"), "#7e9a72"),
    check: checked("rgb(140 75 50 / .24)", "#efd1a6"),
  },
  doodle: {
    dots: motif(tinyHeart("#6b5044"), "#fff0cf"),
    stripe: candy("#f1a1ad", "#fff7e8"),
    mint: motif(tinyRainbow("#547a87"), "#dceef0"),
    check: motif(tinyBow("#7562a0"), "#eee5f6"),
  },
  denim: {
    dots: ticks("rgb(255 255 255 / .48)", "#5c7fa8"),
    stripe: candy("#d7e5ef", "#7294b8"),
    mint: dotted("rgb(255 255 255 / .75)", "#91b4ca"),
    check: checked("rgb(255 255 255 / .22)", "#365a82"),
  },
};

export const TAPE_PACK_KEYS: readonly string[] = Object.keys(TAPE_PACKS);

export function isTapePackKey(value: unknown): value is string {
  return typeof value === "string" && TAPE_PACK_KEYS.includes(value);
}

/** A pack as custom properties for the `.tape-*` classes. Picnic is `initial`: their own fallbacks. */
export function tapeVars(key: string): Record<string, string> {
  const pack = TAPE_PACKS[key] ?? null;
  return Object.fromEntries(TAPE_TONES.map((tone) => [`--tape-${tone}`, pack?.[tone] ?? "initial"]));
}

/* --------------------------------- mascot -------------------------------- */

/** Swaps the art inside the shared cherry mark, wherever a loop's pages show it. */
export function mascotVars(key: string): Record<string, string> {
  if (key === DEFAULT_MASCOT || !isMascotKey(key)) return { "--mascot-image": "initial", "--mascot-cherries": "initial" };
  return { "--mascot-image": `url("${stickerSrc(key)}")`, "--mascot-cherries": "0" };
}

/* ------------------------------- the sheet -------------------------------- */

const declarations = (vars: Record<string, string>) =>
  Object.entries(vars).map(([name, value]) => `${name}:${value}`).join(";");

function pageRule(scheme: ThemeName, key: string, tokens: SchemeTokens): string {
  const { image, size } = pageLayers(key, tokens);
  return `html[data-theme="${scheme}"]{--page-image:${image};--page-size:${size}}`;
}

/**
 * Everything a loop adds on top of the stylesheet: its colours, then whichever of
 * the page, paper, tape and mascot it moved off their defaults.
 */
export function stationeryCss(settings: StationerySettings): string {
  const parts = [themeCss(resolveTheme(settings))];

  if (isBackgroundKey(settings.background) && settings.background !== DEFAULT_BACKGROUND) {
    const { light, dark } = previewTheme(settings);
    parts.push(pageRule("light", settings.background, light), pageRule("dark", settings.background, dark));
  }

  const chosen: Record<string, string> = {
    ...(isPaperPackKey(settings.paperPack) && settings.paperPack !== DEFAULT_PAPER_PACK ? paperVars(settings.paperPack) : {}),
    ...(isTapePackKey(settings.tapePack) && settings.tapePack !== DEFAULT_TAPE_PACK ? tapeVars(settings.tapePack) : {}),
    ...(isMascotKey(settings.mascot) && settings.mascot !== DEFAULT_MASCOT ? mascotVars(settings.mascot) : {}),
  };
  if (Object.keys(chosen).length > 0) parts.push(`html{${declarations(chosen)}}`);

  return parts.join("");
}
