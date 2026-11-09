import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CELEBRATION_KEYS,
  COVER_TINTS,
  COVER_TINT_KEYS,
  DIVIDER_KEYS,
  SEAL_STYLES,
  SIGNATURE_BOARD,
  WAX_COLOR_KEYS,
  cleanLine,
  cleanPlacement,
  isCelebrationKey,
  isCoverTint,
  isDividerKey,
  isSealStyle,
  isStickerKey,
  isWaxColor,
  parseSignature,
  signatureBox,
  signaturePath,
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
