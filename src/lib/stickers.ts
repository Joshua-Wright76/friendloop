/**
 * The sticker art: one set of drawings in `public/stickers`, as SVG for the web and
 * PNG (`scripts/render-stickers.mjs`) for email, where SVG doesn't reliably show.
 * A loop's mascot and a person's charm both come from here.
 */

export const DEFAULT_MASCOT = "cherries";

export const MASCOT_KEYS: readonly string[] = [
  DEFAULT_MASCOT, "strawberry", "lemon", "frog", "snail", "bee",
  "duck", "cat", "mushroom", "daisy", "star", "teacup",
];

export const CHARM_KEYS: readonly string[] = [
  "strawberry", "cherries", "lemon", "peach", "frog", "snail", "bee", "duck", "cat", "ghost",
  "mushroom", "daisy", "tulip", "sprout", "star", "moon", "cloud", "rainbow", "heart", "teacup",
];

export const FRAME_KEYS: readonly string[] = ["stitched", "doily", "daisy", "rosette", "stamp", "polaroid"];

export function isMascotKey(value: unknown): value is string {
  return typeof value === "string" && MASCOT_KEYS.includes(value);
}

export function isCharmKey(value: unknown): value is string {
  return typeof value === "string" && CHARM_KEYS.includes(value);
}

export function isFrameKey(value: unknown): value is string {
  return typeof value === "string" && FRAME_KEYS.includes(value);
}

export function stickerSrc(key: string): string {
  return `/stickers/${key}.svg`;
}

export function stickerPng(key: string): string {
  return `/stickers/png/${key}.png`;
}
