import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  EMAIL_SEAL_SIZE,
  EMAIL_STAMP,
  emailSealImages,
  escapeXml,
  postmarkDate,
  postmarkSvg,
  ringFontSize,
  sealPng,
  seededRandom,
  stampPng,
  stampSvg,
  waxOutline,
  waxSealSvg,
} from "./seal-art.ts";
import { WAX_COLORS, WAX_COLOR_KEYS } from "./looks.ts";
import { MASCOT_KEYS } from "./stickers.ts";

test("a seed always gives the same stream, and different seeds different ones", () => {
  const take = (seed: string) => {
    const random = seededRandom(seed);
    return Array.from({ length: 5 }, () => random());
  };
  assert.deepEqual(take("frog"), take("frog"));
  assert.notDeepEqual(take("frog"), take("bee"));
  for (const value of take("cherries")) assert.ok(value >= 0 && value < 1);
});

test("text for an SVG has the characters XML cares about escaped", () => {
  assert.equal(escapeXml(`<b class="x">Tom & Jerry's</b>`), "&lt;b class=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/b&gt;");
});

test("each mascot pours its own seal, the same way every time, inside its board", () => {
  assert.equal(waxOutline("frog"), waxOutline("frog"));
  assert.notEqual(waxOutline("frog"), waxOutline("snail"));
  for (const seed of MASCOT_KEYS) {
    const numbers = waxOutline(seed).match(/-?[\d.]+/g)!.map(Number);
    assert.ok(numbers.every((n) => n > 0 && n < 120), seed);
  }
});

test("a wax seal wears its colour's three tones, its own ids, and the mascot debossed", () => {
  const svg = waxSealSvg({ mascotHref: "/stickers/frog.svg", color: "moss", id: "a1" });
  for (const tone of Object.values(WAX_COLORS.moss)) assert.ok(svg.includes(tone), tone);
  assert.match(svg, /href="\/stickers\/frog\.svg"/);
  assert.match(svg, /filter="url\(#a1-deboss\)"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.doesNotMatch(svg, /id="(?!a1-)/);
  // A wax that isn't ours pours cherry; the seed, not the id, decides the pour.
  assert.ok(waxSealSvg({ mascotHref: "x", color: "teal", id: "b" }).includes(WAX_COLORS.cherry.body));
  assert.equal(
    waxSealSvg({ mascotHref: "x", color: "ink", id: "c", seed: "duck" }).replace(/(id="|#)c-/g, "$1"),
    waxSealSvg({ mascotHref: "x", color: "ink", id: "d", seed: "duck" }).replace(/(id="|#)d-/g, "$1"),
  );
});

test("a stamp carries the round's number only when it's given one", () => {
  assert.match(stampSvg({ mascotHref: "/stickers/bee.svg", number: 14, id: "s" }), />14<\/text>/);
  assert.match(stampSvg({ mascotHref: "/stickers/bee.svg", number: 3.7, id: "s" }), />3<\/text>/);
  assert.doesNotMatch(stampSvg({ mascotHref: "/stickers/bee.svg", id: "s" }), /<text/);
});

test("a postmark rings the loop's name, escaped, and keeps a long one to one turn", () => {
  const svg = postmarkSvg({ loopName: "Tom & <Jerry>", number: 14, day: "8 NOV", year: "2026", id: "p" });
  assert.match(svg, /TOM &amp; &lt;JERRY&gt; · ROUND 14 · /);
  assert.match(svg, />8 NOV</);
  assert.match(svg, />2026</);
  const long = postmarkSvg({ loopName: "The Extremely Long Saturday Morning Pancake Society", number: 120, day: "1 JAN", year: "2027", id: "q" });
  assert.match(long, /…/);
  assert.match(long, /ROUND 120/);
  assert.equal(ringFontSize(1), 10.5);
  assert.equal(ringFontSize(500), 6.2);
  assert.equal(ringFontSize(0), 10.5);
});

test("a postmark's day is the loop's own, whatever the server's", () => {
  const instant = new Date("2026-11-08T03:00:00Z");
  assert.deepEqual(postmarkDate(instant, "America/Los_Angeles"), { day: "7 NOV", year: "2026" });
  assert.deepEqual(postmarkDate(instant, "Asia/Tokyo"), { day: "8 NOV", year: "2026" });
  assert.deepEqual(postmarkDate(instant, "Not/AZone"), { day: "8 NOV", year: "2026" });
});

test("email asks for a picture that exists for every mascot and wax", () => {
  assert.equal(sealPng("frog", "moss"), "/seals/wax-frog-moss.png");
  assert.equal(sealPng("ghost", "teal"), "/seals/wax-cherries-cherry.png");
  assert.equal(stampPng("bee"), "/seals/stamp-bee.png");
  assert.equal(stampPng(""), "/seals/stamp-cherries.png");
  const images = emailSealImages();
  assert.equal(images.length, MASCOT_KEYS.length * WAX_COLOR_KEYS.length + MASCOT_KEYS.length);
  for (const image of images) assert.ok(existsSync(`public${image.path}`), `${image.path}: run node scripts/render-seals.mjs`);
  assert.ok(EMAIL_SEAL_SIZE > 0 && EMAIL_STAMP.width > 0);
});
