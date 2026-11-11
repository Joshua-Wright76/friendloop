import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  CHARM_KEYS,
  DEFAULT_MASCOT,
  FRAME_KEYS,
  MASCOT_KEYS,
  isCharmKey,
  isFrameKey,
  isMascotKey,
  stickerPng,
  stickerSrc,
} from "./stickers.ts";

const copy = JSON.parse(readFileSync("src/content/copy.json", "utf8"));

test("every sticker offered has its drawing, its email version and a name", () => {
  for (const key of new Set([...MASCOT_KEYS, ...CHARM_KEYS])) {
    assert.ok(existsSync(`public${stickerSrc(key)}`), `${key} svg`);
    assert.ok(existsSync(`public${stickerPng(key)}`), `${key} png`);
    assert.ok(copy.stickers[key], `${key} name`);
  }
});

test("every frame has a name and a style", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  for (const key of FRAME_KEYS) {
    assert.ok(copy.identity.look.frames[key], key);
    assert.ok(css.includes(`.avatar[data-frame="${key}"]`), key);
  }
});

test("the checks only pass their own lists", () => {
  assert.equal(MASCOT_KEYS[0], DEFAULT_MASCOT);
  for (const [check, keys] of [[isMascotKey, MASCOT_KEYS], [isCharmKey, CHARM_KEYS], [isFrameKey, FRAME_KEYS]] as const) {
    for (const key of keys) assert.equal(check(key), true, key);
    assert.equal(check("../../etc/passwd"), false);
    assert.equal(check(""), false);
    assert.equal(check(null), false);
  }
  for (const key of CHARM_KEYS) assert.equal(isMascotKey(key), true, `${key} can be a charm or the loop's mascot`);
});
