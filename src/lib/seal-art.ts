import { copy, text } from "./copy.ts";
import { DEFAULT_WAX, WAX_COLORS, WAX_COLOR_KEYS, isWaxColor } from "./looks.ts";
import { DEFAULT_MASCOT, MASCOT_KEYS, isMascotKey } from "./stickers.ts";

/**
 * The marks a delivered round is sent with: a wax seal pressed with the loop's
 * mascot, or a postage stamp with a cancellation inked over it. Each is drawn here
 * once, as an SVG string, so the web shows exactly what the email's PNGs were
 * rendered from (`scripts/render-seals.mjs`). Every colour and key comes from the
 * tables in `looks.ts` and `stickers.ts`; the only text a person wrote, the loop's
 * name on the postmark, is escaped before it goes in.
 */

/* ------------------------------- helpers -------------------------------- */

/** A small, steady random stream from a word, so a seal's pour is the same everywhere it's drawn. */
export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fixed = (n: number) => Number(n.toFixed(2));

/** Text for inside an SVG: the five characters XML cares about, escaped. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A closed, smooth curve through points (Catmull-Rom, as cubic Béziers). */
function smoothClosed(points: Array<[number, number]>): string {
  const n = points.length;
  const at = (i: number) => points[(i + n) % n];
  let d = `M${fixed(points[0][0])} ${fixed(points[0][1])}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${fixed(c1[0])} ${fixed(c1[1])} ${fixed(c2[0])} ${fixed(c2[1])} ${fixed(p2[0])} ${fixed(p2[1])}`;
  }
  return `${d}Z`;
}

/* -------------------------------- the wax -------------------------------- */

const SEAL_BOX = 120;
const CENTER = 60;
/** The pressed disc. The wax around it is the rim. */
const DISC = 29;

/**
 * Where poured wax stopped: a lumpy circle with a few rounded runs where it
 * spread further. The same seed always pours the same way.
 */
export function waxOutline(seed: string): string {
  const random = seededRandom(seed);
  const phases = [random(), random(), random()].map((value) => value * Math.PI * 2);
  // Two or three runs, spaced apart, each a soft rounded tongue where the wax spread further.
  const count = 2 + Math.floor(random() * 2);
  const runs = Array.from({ length: count }, (_, index) => ({
    angle: ((index + 0.15 + random() * 0.5) / count) * Math.PI * 2,
    reach: 4 + random() * 4,
    width: 0.13 + random() * 0.1,
  }));
  const points: Array<[number, number]> = [];
  const steps = 96;
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    let radius = 44 + 1.5 * Math.sin(3 * angle + phases[0]) + 1 * Math.sin(5 * angle + phases[1]) + 0.55 * Math.sin(9 * angle + phases[2]);
    for (const run of runs) {
      const apart = Math.atan2(Math.sin(angle - run.angle), Math.cos(angle - run.angle));
      radius += run.reach * Math.exp(-((apart / run.width) ** 2));
    }
    points.push([CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius]);
  }
  return smoothClosed(points);
}

export type WaxSealArt = {
  /** The mascot's drawing: its web address, or a data URL when rendering for email. */
  mascotHref: string;
  /** A key from `WAX_COLORS`; anything else pours cherry. */
  color: string;
  /** Keeps the gradient and filter ids apart from any other seal on the page. */
  id: string;
  /** Changes the pour. Defaults to the id. */
  seed?: string;
};

/**
 * A seal of poured wax: an irregular outline with soft runs, a raised rim, a disc
 * pressed lower than the rim (shadowed along its top-left edge, lit along its
 * bottom-right), the mascot debossed into it, a gloss where the light catches, and
 * a soft shadow under it all. Drawn on a 120 × 120 board; scale it with CSS.
 */
export function waxSealSvg({ mascotHref, color, id, seed }: WaxSealArt): string {
  const wax = WAX_COLORS[isWaxColor(color) ? color : DEFAULT_WAX];
  const outline = waxOutline(seed ?? id);
  const art = 34;
  const at = CENTER - art / 2;
  const ref = (name: string) => `${id}-${name}`;
  /** A stretch of circle around the seal's centre, in degrees clockwise from three o'clock. */
  const arc = (radius: number, from: number, to: number) => {
    const point = (degrees: number) => {
      const angle = (degrees * Math.PI) / 180;
      return `${fixed(CENTER + Math.cos(angle) * radius)} ${fixed(CENTER + Math.sin(angle) * radius)}`;
    };
    return `M${point(from)}A${radius} ${radius} 0 0 1 ${point(to)}`;
  };
  const scaled = (k: number) => `translate(${CENTER} ${CENTER}) scale(${k}) translate(${-CENTER} ${-CENTER})`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${SEAL_BOX} ${SEAL_BOX}" class="wax-art" aria-hidden="true" focusable="false">`,
    "<defs>",
    `<radialGradient id="${ref("body")}" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="${wax.shine}"/><stop offset=".38" stop-color="${wax.body}"/><stop offset=".86" stop-color="${wax.deep}"/><stop offset="1" stop-color="${wax.deep}"/></radialGradient>`,
    `<radialGradient id="${ref("disc")}" cx="58%" cy="60%" r="62%"><stop offset="0" stop-color="${wax.body}"/><stop offset=".75" stop-color="${wax.body}"/><stop offset="1" stop-color="${wax.deep}"/></radialGradient>`,
    // Light from the top left: the wall down into the disc is dark where it faces away, lit where it faces the light.
    `<linearGradient id="${ref("wall")}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${wax.deep}"/><stop offset=".45" stop-color="${wax.deep}" stop-opacity=".35"/><stop offset=".6" stop-color="${wax.shine}" stop-opacity=".1"/><stop offset="1" stop-color="${wax.shine}"/></linearGradient>`,
    // The rim the press pushed up: lit on its top-left shoulder, shaded on its bottom-right one.
    `<linearGradient id="${ref("crest")}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset=".38" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".32"/></linearGradient>`,
    `<linearGradient id="${ref("edge")}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${wax.shine}" stop-opacity=".95"/><stop offset=".45" stop-color="${wax.body}" stop-opacity="0"/><stop offset="1" stop-color="${wax.deep}"/></linearGradient>`,
    `<clipPath id="${ref("pour")}"><path d="${outline}"/></clipPath>`,
    `<clipPath id="${ref("pressed")}"><circle cx="${CENTER}" cy="${CENTER}" r="${DISC}"/></clipPath>`,
    `<filter id="${ref("drop")}" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="2.6"/></filter>`,
    `<filter id="${ref("soft")}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".9"/></filter>`,
    `<filter id="${ref("blur")}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".45"/></filter>`,
    `<filter id="${ref("gloss")}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2"/></filter>`,
    // A faint mottle, so the surface reads as wax rather than plastic.
    `<filter id="${ref("grain")}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2 1.25"/></filter>`,
    // The mascot as a relief pressed into the wax: its shape a little darker than the
    // disc, darker still where the drawing is dark, shadowed inside its top-left edges
    // and lit inside its bottom-right ones.
    `<filter id="${ref("deboss")}" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">`,
    `<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -.3 -.59 -.11 0 1" result="ink"/>`,
    `<feComposite in="ink" in2="SourceAlpha" operator="in" result="lines"/>`,
    `<feFlood flood-color="${wax.deep}" flood-opacity=".45"/><feComposite in2="SourceAlpha" operator="in" result="recess"/>`,
    `<feFlood flood-color="${wax.deep}" flood-opacity=".55"/><feComposite in2="lines" operator="in" result="grooves"/>`,
    `<feOffset in="SourceAlpha" dx="1.2" dy="1.2" result="down"/><feComposite in="SourceAlpha" in2="down" operator="out" result="upperLip"/>`,
    `<feFlood flood-color="#000" flood-opacity=".62"/><feComposite in2="upperLip" operator="in"/><feGaussianBlur stdDeviation=".45" result="shade"/>`,
    `<feOffset in="SourceAlpha" dx="-1" dy="-1" result="up"/><feComposite in="SourceAlpha" in2="up" operator="out" result="lowerLip"/>`,
    `<feFlood flood-color="${wax.shine}" flood-opacity=".95"/><feComposite in2="lowerLip" operator="in"/><feGaussianBlur stdDeviation=".35" result="light"/>`,
    `<feMerge><feMergeNode in="recess"/><feMergeNode in="grooves"/><feMergeNode in="shade"/><feMergeNode in="light"/></feMerge>`,
    "</filter>",
    "</defs>",
    // A soft shadow under the whole pour, and a tighter one where it meets the paper.
    `<path d="${outline}" transform="translate(1.6 3.6)" fill="#2a0d14" opacity=".4" filter="url(#${ref("drop")})" class="wax-art__shadow"/>`,
    `<path d="${outline}" transform="translate(.5 1.2)" fill="#2a0d14" opacity=".3" filter="url(#${ref("blur")})" class="wax-art__shadow"/>`,
    `<g clip-path="url(#${ref("pour")})">`,
    `<path d="${outline}" fill="url(#${ref("body")})"/>`,
    // Where the wax ran out thin and flat: a couple of faint ripples following the pour's edge.
    `<g fill="none" filter="url(#${ref("blur")})">`,
    `<path d="${outline}" transform="${scaled(0.9)}" stroke="${wax.deep}" stroke-opacity=".32" stroke-width="1.1"/>`,
    `<path d="${outline}" transform="${scaled(0.9)} translate(-.5 -.5)" stroke="${wax.shine}" stroke-opacity=".35" stroke-width=".7"/>`,
    `<path d="${outline}" transform="${scaled(0.97)}" stroke="${wax.deep}" stroke-opacity=".25" stroke-width=".9"/>`,
    "</g>",
    // The rim: a raised ring around the disc, lit along its top left and shaded along its bottom right.
    `<circle cx="${CENTER}" cy="${CENTER}" r="${DISC + 6}" fill="none" stroke="${wax.body}" stroke-width="9" filter="url(#${ref("soft")})"/>`,
    `<circle cx="${CENTER}" cy="${CENTER}" r="${DISC + 6}" fill="none" stroke="url(#${ref("crest")})" stroke-width="8" filter="url(#${ref("soft")})"/>`,
    `<path d="${arc(DISC + 7.5, 192, 290)}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.6" stroke-linecap="round" filter="url(#${ref("soft")})"/>`,
    `<path d="${arc(DISC + 10.5, 10, 110)}" fill="none" stroke="${wax.deep}" stroke-opacity=".7" stroke-width="2.6" stroke-linecap="round" filter="url(#${ref("soft")})"/>`,
    // The rounded edge of the pour: light on top left, dark where it curls under on the bottom right.
    `<path d="${outline}" fill="none" stroke="url(#${ref("edge")})" stroke-width="3.4" filter="url(#${ref("blur")})"/>`,
    `<rect width="${SEAL_BOX}" height="${SEAL_BOX}" fill="${wax.deep}" filter="url(#${ref("grain")})" opacity=".08"/>`,
    "</g>",
    // The pressed disc and the wall down into it.
    `<circle cx="${CENTER}" cy="${CENTER}" r="${DISC + 1.8}" fill="url(#${ref("wall")})" filter="url(#${ref("blur")})"/>`,
    `<circle cx="${CENTER}" cy="${CENTER}" r="${DISC}" fill="url(#${ref("disc")})"/>`,
    `<g clip-path="url(#${ref("pressed")})">`,
    `<circle cx="${CENTER + 2.4}" cy="${CENTER + 2.4}" r="${DISC + 1}" fill="none" stroke="${wax.deep}" stroke-opacity=".85" stroke-width="3.6" filter="url(#${ref("soft")})"/>`,
    `<image href="${mascotHref}" xlink:href="${mascotHref}" x="${at}" y="${at}" width="${art}" height="${art}" filter="url(#${ref("deboss")})"/>`,
    "</g>",
    // The gloss: a broad soft sheen on the rim, a small bright glint, and a little light caught on the far wall.
    `<g clip-path="url(#${ref("pour")})">`,
    `<ellipse cx="40" cy="31" rx="17" ry="7" transform="rotate(-36 40 31)" fill="#fff" opacity=".3" filter="url(#${ref("gloss")})"/>`,
    `<ellipse cx="35.5" cy="29.5" rx="4.6" ry="1.6" transform="rotate(-40 35.5 29.5)" fill="#fff" opacity=".75" filter="url(#${ref("blur")})"/>`,
    `<ellipse cx="80" cy="83" rx="6" ry="1.6" transform="rotate(-45 80 83)" fill="#fff" opacity=".22" filter="url(#${ref("soft")})"/>`,
    "</g>",
    "</svg>",
  ].join("");
}

/* ------------------------------ the postmark ----------------------------- */

const STAMP = { width: 76, height: 92 };

export type StampArt = {
  mascotHref: string;
  /** The round number in the stamp's corner. Email leaves it out and says it in words beside. */
  number?: number | null;
  id: string;
};

/**
 * A perforated postage stamp with the mascot on it. Its colours are custom
 * properties with Gingham's values behind them, so on the web it wears the loop's
 * paper and in the email's PNG it wears Gingham.
 */
export function stampSvg({ mascotHref, number = null, id }: StampArt): string {
  const { width, height } = STAMP;
  const holes: string[] = [];
  const step = 7.6;
  for (let x = step / 2; x < width; x += step) holes.push(`<circle cx="${fixed(x)}" cy="0" r="2.6"/><circle cx="${fixed(x)}" cy="${height}" r="2.6"/>`);
  for (let y = step / 2; y < height; y += step) holes.push(`<circle cx="0" cy="${fixed(y)}" r="2.6"/><circle cx="${width}" cy="${fixed(y)}" r="2.6"/>`);
  const corner = number === null ? "" : `<text x="${width - 12}" y="20" text-anchor="end" class="stamp-art__value" font-family="Nunito, ui-rounded, sans-serif" font-weight="800" font-size="11" style="fill:var(--accent-ink,#9e2440)">${Math.max(0, Math.floor(number))}</text>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="-3 -3 ${width + 6} ${height + 6}" class="stamp-art" aria-hidden="true" focusable="false">`,
    `<defs><mask id="${id}-perf"><rect x="-3" y="-3" width="${width + 6}" height="${height + 6}" fill="#fff"/><g fill="#000">${holes.join("")}</g></mask>`,
    // The perforated edge only shows if the paper casts a little shadow on whatever it's stuck to.
    `<filter id="${id}-lift" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy=".9" stdDeviation=".9" flood-color="#3d2a30" flood-opacity=".35"/></filter></defs>`,
    `<g filter="url(#${id}-lift)"><g mask="url(#${id}-perf)">`,
    `<rect x="0" y="0" width="${width}" height="${height}" class="stamp-art__paper" style="fill:var(--stamp-paper,#fffdf7)"/>`,
    `<rect x="7" y="7" width="${width - 14}" height="${height - 14}" style="fill:var(--accent-soft,#fde4e9)"/>`,
    `<rect x="9.5" y="9.5" width="${width - 19}" height="${height - 19}" fill="none" style="stroke:var(--accent-line,#f3b1bf)" stroke-width="1"/>`,
    `<image href="${mascotHref}" xlink:href="${mascotHref}" x="${width / 2 - 21}" y="${height / 2 - 17}" width="42" height="42"/>`,
    corner,
    `<path d="M14 ${height - 17}h${width - 28}" style="stroke:var(--accent-line,#f3b1bf)" stroke-width="1.2" stroke-dasharray="2 2.4"/>`,
    "</g></g>",
    "</svg>",
  ].join("");
}

export type PostmarkArt = {
  loopName: string;
  number: number;
  /** "8 NOV" and "2026", already in the loop's own timezone. */
  day: string;
  year: string;
  id: string;
};

/** "8 NOV" and "2026": the day a round went out, in the loop's own timezone, as a cancellation prints it. */
export function postmarkDate(instant: Date, timezone: string): { day: string; year: string } {
  const parts = (zone: string) => {
    const format = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: zone }).formatToParts(instant);
    const part = (type: string) => format.find((item) => item.type === type)?.value ?? "";
    return { day: `${part("day")} ${part("month")}`.toUpperCase(), year: part("year") };
  };
  try {
    return parts(timezone);
  } catch {
    return parts("UTC");
  }
}

/** How large the ring's letters can be for this many of them, so a long name still goes round once. */
export function ringFontSize(characters: number): number {
  return fixed(Math.min(10.5, Math.max(6.2, 205 / Math.max(1, characters))));
}

const RING_MAX = 44;

/**
 * The cancellation: a double ring with the loop's name and round around it, the
 * day in the middle, and wavy lines running off to the right. Ink is a custom
 * property, so it can lighten for dark paper.
 */
export function postmarkSvg({ loopName, number, day, year, id }: PostmarkArt): string {
  const round = text(copy.issue.round, { number: Math.max(0, Math.floor(number)) }).toUpperCase();
  const name = [...loopName.toUpperCase()];
  const room = RING_MAX - round.length - 6;
  const shortName = name.length > room ? `${name.slice(0, room - 1).join("").trim()}…` : name.join("");
  const ring = `${shortName} · ${round} · `;
  const size = ringFontSize([...ring].length);
  const ink = "var(--postmark-ink,rgb(47 56 92 / .7))";
  const waves = [0, 1, 2, 3]
    .map((line) => `<path d="M101 ${31 + line * 14}q10-6.5 20 0t20 0 20 0 20 0 20 0" fill="none" stroke-width="2.3" stroke-linecap="round"/>`)
    .join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 110" class="postmark-art" aria-hidden="true" focusable="false">`,
    `<defs><path id="${id}-ring" d="M55 55m-39.5 0a39.5 39.5 0 1 1 79 0a39.5 39.5 0 1 1-79 0"/></defs>`,
    `<g style="fill:none;stroke:${ink}">`,
    `<circle cx="55" cy="55" r="49" stroke-width="2.4"/>`,
    `<circle cx="55" cy="55" r="30" stroke-width="1.6"/>`,
    waves,
    "</g>",
    `<g style="fill:${ink}" font-family="Nunito, ui-rounded, sans-serif" font-weight="800">`,
    `<text font-size="${size}" letter-spacing=".9"><textPath href="#${id}-ring" textLength="243" lengthAdjust="spacing">${escapeXml(ring)}</textPath></text>`,
    `<text x="55" y="53" text-anchor="middle" font-size="13">${escapeXml(day)}</text>`,
    `<text x="55" y="67" text-anchor="middle" font-size="10.5" letter-spacing="1">${escapeXml(year)}</text>`,
    "</g>",
    "</svg>",
  ].join("");
}

/* -------------------------------- for email ------------------------------- */

/** Seals and stamps are drawn at twice their size in email, for sharp screens. */
export const EMAIL_SEAL_SIZE = 72;
export const EMAIL_STAMP = { width: 52, height: 62 };

export function sealPng(mascot: string, color: string): string {
  return `/seals/wax-${isMascotKey(mascot) ? mascot : DEFAULT_MASCOT}-${isWaxColor(color) ? color : DEFAULT_WAX}.png`;
}

export function stampPng(mascot: string): string {
  return `/seals/stamp-${isMascotKey(mascot) ? mascot : DEFAULT_MASCOT}.png`;
}

/** Every picture email can ask for, and how to draw it. For the render script. */
export function emailSealImages(): Array<{ path: string; kind: "wax" | "stamp"; mascot: string; color: string | null }> {
  return [
    ...MASCOT_KEYS.flatMap((mascot) => WAX_COLOR_KEYS.map((color) => ({ path: sealPng(mascot, color), kind: "wax" as const, mascot, color }))),
    ...MASCOT_KEYS.map((mascot) => ({ path: stampPng(mascot), kind: "stamp" as const, mascot, color: null })),
  ];
}
