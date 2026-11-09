import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { CARD_REACH, dividerBorder, dividerCss, emailDividerStrip, emailDividerStrips } from "./dividers.ts";
import { DIVIDER_KEYS } from "./looks.ts";
import { GINGHAM_RESOLVED, THEME_PRESET_KEYS, previewTheme } from "./theme.ts";

const { light, dark } = GINGHAM_RESOLVED;
const copy = JSON.parse(readFileSync("src/content/copy.json", "utf8"));

test("the stitches are no divider at all, and add nothing", () => {
  for (const key of [null, undefined, "", "stitches", "url(evil)"]) {
    assert.equal(dividerBorder(key, light), "none");
    assert.equal(dividerCss(key, light, dark), "");
  }
});

test("each divider is a border image in the loop's own colours, centred on the old line", () => {
  for (const key of DIVIDER_KEYS) {
    const border = dividerBorder(key, light);
    assert.match(border, /^url\("data:image\/svg\+xml,/, key);
    assert.match(border, / round$/, key);
    assert.ok(copy.stationery.dividers[key], `${key} name`);
  }
  assert.ok(decodeURIComponent(dividerBorder("ricrac", light)).includes(light.accent));
  assert.ok(decodeURIComponent(dividerBorder("ricrac", dark)).includes(dark.accent));
  // A ticket's notches sit at the card's edges, however far away those are.
  assert.match(dividerBorder("ticket", light), new RegExp(`/ 11px ${CARD_REACH}px 0 ${CARD_REACH}px round$`));
  assert.match(dividerBorder("ticket", light, 13), /\/ 11px 13px 0 13px round$/);
  assert.match(dividerBorder("lace", light), /\/ 7px 0px 0 0px round$/);
});

test("a chosen divider is one custom property per scheme", () => {
  const css = dividerCss("vine", light, dark);
  assert.match(css, /^html\[data-theme="light"\]\{--divider:url\(.*\}html\[data-theme="dark"\]\{--divider:url\(.*\}$/);
});

test("email gets a strip per divider and preset, and every one has been rendered", () => {
  assert.equal(emailDividerStrip(null, "meadow"), null);
  assert.equal(emailDividerStrip("ricrac", "meadow")!.path, "/dividers/email/ricrac-meadow.png");
  assert.equal(emailDividerStrip("ricrac", "plaid")!.path, "/dividers/email/ricrac-gingham.png");
  assert.equal(emailDividerStrip("ticket", null)!.width, 12, "a ticket keeps only its tear line in email");
  const strips = emailDividerStrips();
  assert.equal(strips.length, DIVIDER_KEYS.length * THEME_PRESET_KEYS.length);
  for (const strip of strips) {
    assert.ok(existsSync(`public${strip.path}`), `${strip.path}: run node scripts/render-email-dividers.mjs`);
    assert.match(strip.svg, /^<svg xmlns=/);
  }
  const meadow = strips.find((strip) => strip.path === "/dividers/email/ricrac-meadow.png")!;
  assert.ok(meadow.svg.includes(previewTheme({ preset: "meadow", accent: null }).light.accent));
});
