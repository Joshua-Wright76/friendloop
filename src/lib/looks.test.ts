import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CELEBRATION_KEYS,
  COVER_TINTS,
  COVER_TINT_KEYS,
  DIVIDER_KEYS,
  SEAL_STYLES,
  SIGNATURE_BOARD,
  SIGNATURE_INK,
  SIGNATURE_MAX_POINTS,
  SIGNATURE_MAX_STROKES,
  SIGNATURE_NIB,
  WAX_COLOR_KEYS,
  NO_MARKS,
  cleanLine,
  cleanPlacement,
  coverColumns,
  coverOf,
  freeSpot,
  MAX_TILT,
  NUDGE_STEP,
  nudgePlacement,
  placementAt,
  marksColumns,
  marksOf,
  isCelebrationKey,
  isCoverTint,
  isDividerKey,
  isSealStyle,
  isStickerKey,
  isWaxColor,
  inkWidths,
  parseSignature,
  signatureBox,
  signatureFit,
  signaturePath,
  stickerChoice,
} from "./looks.ts";
import { contrastRatio } from "./theme.ts";

test("a line folds to one short line and keeps whole emoji", () => {
  assert.equal(cleanLine("  knee-deep\n\nin   boxes \t", 60), "knee-deep in boxes");
  assert.equal(cleanLine("a\u0000b", 60), "a b");
  assert.equal(cleanLine("   ", 60), null);
  assert.equal(cleanLine(42, 60), null);
  assert.equal(cleanLine("📦📦📦", 2), "📦📦");
  assert.equal(cleanLine("abc def", 4), "abc");
});

test("the checks only pass their own lists", () => {
  for (const [check, keys] of [
    [isSealStyle, SEAL_STYLES],
    [isWaxColor, WAX_COLOR_KEYS],
    [isDividerKey, DIVIDER_KEYS],
    [isCelebrationKey, CELEBRATION_KEYS],
    [isCoverTint, COVER_TINT_KEYS],
  ] as const) {
    for (const key of keys) assert.equal(check(key), true, key);
    for (const bad of ["", null, undefined, "constructor", "../x", 3]) assert.equal(check(bad), false, String(bad));
  }
  assert.equal(isStickerKey("frog"), true);
  assert.equal(isStickerKey("frog.svg"), false);
});

test("every cover's name is readable on its tint", () => {
  for (const [key, { tint, ink }] of Object.entries(COVER_TINTS)) {
    assert.ok(contrastRatio(ink, tint) >= 4.5, `${key}: ${contrastRatio(ink, tint).toFixed(2)}`);
  }
});

test("a signature is kept on the board, rounded, or refused whole", () => {
  assert.deepEqual(parseSignature([[1.4, 2.6, 700, -5]]), [[1, 3, SIGNATURE_BOARD.width, 0]]);
  assert.deepEqual(parseSignature([[10, 10]]), [[10, 10]]);
  for (const bad of [null, [], [[]], [[1]], [[1, 2, 3]], [["1", 2]], [[NaN, 1]], [[Infinity, 1]], "M0 0", [{}]]) {
    assert.equal(parseSignature(bad), null, JSON.stringify(bad));
  }
  assert.equal(parseSignature(Array.from({ length: 61 }, () => [1, 1])), null);
  assert.equal(parseSignature([Array.from({ length: 2401 * 2 }, () => 1)]), null);
});

test("a signature draws as a path and knows its own box", () => {
  assert.equal(signaturePath([[1, 2, 3, 4, 5, 6], [7, 8]]), "M1 2L3 4 5 6M7 8h0.1");
  assert.deepEqual(signatureBox([[10, 20, 30, 50]], 5), { x: 5, y: 15, width: 30, height: 40 });
  assert.deepEqual(signatureBox([]), { x: 0, y: 0, width: 600, height: 200 });
});

test("a sticker placement stays in the margins", () => {
  assert.deepEqual(cleanPlacement({ side: "left", offset: 140.6, tilt: -40 }), { side: "left", offset: 100, tilt: -16 });
  assert.deepEqual(cleanPlacement({ side: "right", offset: 12.4, tilt: 3.6 }), { side: "right", offset: 12, tilt: 4 });
  for (const bad of [null, "x", { side: "top", offset: 1, tilt: 1 }, { side: "left", offset: "1", tilt: 1 }, { side: "left", offset: 1, tilt: NaN }]) {
    assert.equal(cleanPlacement(bad), null, JSON.stringify(bad));
  }
});

test("a loop's marks are read back safe: clean words, and only our own keys", () => {
  assert.deepEqual(marksOf({}), NO_MARKS);
  assert.deepEqual(
    marksOf({ motto: "  est.\n2019 ", signOff: "xo", sealStyle: "wax", sealColor: "moss", divider: "lace", celebration: "hop" }),
    { motto: "est. 2019", signOff: "xo", sealStyle: "wax", sealColor: "moss", divider: "lace", celebration: "hop" },
  );
  // Cherry is the original wax, and anything not in a table is no choice at all.
  assert.deepEqual(
    marksOf({ motto: "   ", sealStyle: "ribbon", sealColor: "cherry", divider: "<b>", celebration: "fireworks" }),
    NO_MARKS,
  );
  assert.equal(marksOf({ sealColor: "teal" }).sealColor, null);
});

test("marks become columns: words cleaned, originals stored as nothing, strangers refused", () => {
  assert.deepEqual(marksColumns({}), { ok: true, columns: {} });
  assert.deepEqual(
    marksColumns({ motto: " still\tterrible ", signOff: "", sealStyle: "postmark", sealColor: "cherry", divider: "", celebration: "stars" }),
    { ok: true, columns: { motto: "still terrible", signOff: null, sealStyle: "postmark", sealColor: null, divider: null, celebration: "stars" } },
  );
  assert.deepEqual(marksColumns({ sealColor: "ink", divider: "ticket" }), { ok: true, columns: { sealColor: "ink", divider: "ticket" } });
  assert.equal(marksColumns({ motto: "x".repeat(200) }).ok && (marksColumns({ motto: "x".repeat(200) }) as { columns: { motto: string } }).columns.motto.length, 60);
  for (const [field, bad] of [["sealStyle", "ribbon"], ["sealColor", "teal"], ["divider", "url(x)"], ["celebration", "fireworks"]] as const) {
    assert.deepEqual(marksColumns({ [field]: bad }), { ok: false, error: field });
  }
});

test("a sticker choice is a key from the sheet, or nothing, or refused", () => {
  assert.deepEqual(stickerChoice("frog"), { ok: true, sticker: "frog" });
  assert.deepEqual(stickerChoice(""), { ok: true, sticker: null });
  assert.deepEqual(stickerChoice(null), { ok: true, sticker: null });
  for (const bad of [undefined, "frog.svg", "../frog", 3, {}]) assert.deepEqual(stickerChoice(bad), { ok: false }, String(bad));
});

test("ink pools where the pen goes slowly and thins where it races", () => {
  assert.deepEqual(inkWidths([10, 10]), [SIGNATURE_NIB.thick], "a dot is the full nib");
  const slow = inkWidths([0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0]);
  const fast = inkWidths([0, 0, 60, 0, 120, 0, 180, 0, 240, 0, 300, 0]);
  assert.equal(slow.length, 5);
  assert.ok(slow.at(-1)! > fast.at(-1)!, "a slow stroke ends wider than a fast one");
  for (const width of [...slow, ...fast]) assert.ok(width >= SIGNATURE_NIB.thin && width <= SIGNATURE_NIB.thick, String(width));
  // Smoothed: a sudden dash after slow writing narrows gradually, not at once.
  const mixed = inkWidths([0, 0, 1, 0, 2, 0, 3, 0, 100, 0, 200, 0]);
  assert.ok(mixed[3] > SIGNATURE_NIB.thin && mixed[3] < mixed[2]);
  assert.deepEqual(inkWidths([0, 0, 0, 1], { thin: 1, thick: 3 }), [2.37]);
});

test("a signature fits inside a box without changing its shape", () => {
  const strokes = [[100, 50, 500, 150]];
  const box = signatureBox(strokes);
  const fit = signatureFit(strokes, 150, 60);
  assert.ok(fit.width <= 150 && fit.height <= 60);
  assert.ok(Math.abs(fit.width / fit.height - box.width / box.height) < 0.05);
  assert.deepEqual(signatureFit([[10, 10]], 150, 60), { width: 60, height: 60 }, "a dot is square");
  assert.equal(SIGNATURE_INK, "#26365c");
  assert.ok(SIGNATURE_MAX_STROKES > 0 && SIGNATURE_MAX_POINTS > SIGNATURE_MAX_STROKES);
});

/* ------------------------------ round covers ----------------------------- */

test("a cover shows only on a named round, with our own sticker and tint", () => {
  assert.deepEqual(coverOf({ name: "Camping weekend", coverSticker: "mushroom", coverTint: "moss" }), {
    sticker: "mushroom",
    tint: "moss",
    color: COVER_TINTS.moss.tint,
    ink: COVER_TINTS.moss.ink,
  });
  assert.equal(coverOf({ name: null, coverSticker: "mushroom", coverTint: "moss" }), null, "no name, no cover");
  assert.equal(coverOf({ name: "  ", coverSticker: "mushroom", coverTint: "moss" }), null);
  assert.equal(coverOf({ name: "Camping", coverSticker: null, coverTint: "moss" }), null);
  assert.equal(coverOf({ name: "Camping", coverSticker: "mushroom", coverTint: null }), null);
  assert.equal(coverOf({ name: "Camping", coverSticker: "../x", coverTint: "moss" }), null, "a bad row is no cover");
  assert.equal(coverOf({ name: "Camping", coverSticker: "frog", coverTint: "#fff;x" }), null);
});

test("a cover is saved with its name, cleared with it, and refused when it isn't ours", () => {
  assert.deepEqual(coverColumns("Camping", { sticker: "frog", tint: "sky" }), { ok: true, columns: { coverSticker: "frog", coverTint: "sky" } });
  assert.deepEqual(coverColumns("Camping", { sticker: "frog" }), { ok: true, columns: { coverSticker: "frog", coverTint: "moss" } }, "no tint takes the first");
  assert.deepEqual(coverColumns("Camping", { sticker: "frog", tint: "" }), { ok: true, columns: { coverSticker: "frog", coverTint: "moss" } });
  assert.deepEqual(coverColumns("Camping", { sticker: "", tint: "sky" }), { ok: true, columns: { coverSticker: null, coverTint: null } }, "no sticker is no cover");
  assert.deepEqual(coverColumns(null, { sticker: "frog", tint: "sky" }), { ok: true, columns: { coverSticker: null, coverTint: null } }, "no name, no cover");
  assert.deepEqual(coverColumns(null, {}), { ok: true, columns: { coverSticker: null, coverTint: null } });
  assert.deepEqual(coverColumns("Camping", {}), { ok: true, columns: {} }, "left out leaves it");
  assert.deepEqual(coverColumns("Camping", { sticker: "frog.svg", tint: "sky" }), { ok: false });
  assert.deepEqual(coverColumns("Camping", { sticker: "frog", tint: "teal" }), { ok: false });
});

/* ------------------------------- scrapbook ------------------------------- */

/** A fixed run of "random" numbers, repeating. */
const sequence = (...values: number[]) => {
  let index = 0;
  return () => values[index++ % values.length];
};

test("a new sticker goes to the emptiest spot in either margin, tilted a little", () => {
  const first = freeSpot([], sequence(0, 0, 0));
  assert.deepEqual(first, { side: "left", offset: 0, tilt: -4 }, "an empty answer: any spot, here the first");
  const last = freeSpot([], sequence(0.999, 0.999, 0.999));
  assert.deepEqual(last, { side: "right", offset: 100, tilt: MAX_TILT });

  // Both margins hold a sticker at the top: the furthest spots are both bottoms.
  const bottoms = freeSpot([{ side: "left", offset: 0 }, { side: "right", offset: 0 }], sequence(0.6, 0.5, 0.9));
  assert.equal(bottoms.offset, 100);
  assert.equal(bottoms.side, "right");
  // One margin taken: the other margin is all room.
  const across = freeSpot([{ side: "left", offset: 50 }], sequence(0, 0, 0));
  assert.equal(across.side, "right");
  // A reserved corner counts as taken.
  const clear = freeSpot([{ side: "left", offset: 0 }], sequence(0, 0, 0), [{ side: "right", offset: 0 }]);
  assert.equal(clear.offset, 100);
  for (let i = 0; i < 50; i += 1) {
    const spot = freeSpot([{ side: "left", offset: 30 }]);
    assert.ok(Math.abs(spot.tilt) >= 4 && Math.abs(spot.tilt) <= MAX_TILT, String(spot.tilt));
    assert.deepEqual(cleanPlacement(spot), spot, "always a placement the server keeps as is");
  }
});

test("the keyboard moves a sticker a step along its margin, or across, and never off the answer", () => {
  const at = { side: "left" as const, offset: 50, tilt: 6 };
  assert.deepEqual(nudgePlacement(at, "up"), { ...at, offset: 50 - NUDGE_STEP });
  assert.deepEqual(nudgePlacement(at, "down"), { ...at, offset: 50 + NUDGE_STEP });
  assert.deepEqual(nudgePlacement(at, "swap"), { ...at, side: "right" });
  assert.deepEqual(nudgePlacement({ ...at, side: "right" }, "swap"), at);
  assert.equal(nudgePlacement({ ...at, offset: 5 }, "up").offset, 0);
  assert.equal(nudgePlacement({ ...at, offset: 95 }, "down").offset, 100);
});

test("a dragged sticker lands in the margin on the pointer's side, kept inside the answer", () => {
  const box = { left: 100, top: 200, width: 300, height: 140 };
  assert.deepEqual(placementAt({ x: 120, y: 220 }, box, 40, 5), { side: "left", offset: 0, tilt: 5 });
  assert.deepEqual(placementAt({ x: 380, y: 270 }, box, 40, -5), { side: "right", offset: 50, tilt: -5 });
  assert.equal(placementAt({ x: 380, y: 900 }, box, 40, 0).offset, 100);
  assert.equal(placementAt({ x: 380, y: 0 }, box, 40, 0).offset, 0);
  assert.equal(placementAt({ x: 380, y: 250 }, { ...box, height: 30 }, 40, 0).offset, 0, "an answer shorter than the sticker");
});
