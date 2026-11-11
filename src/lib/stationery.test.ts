import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BACKGROUND_KEYS,
  DEFAULT_BACKGROUND,
  DEFAULT_PAPER_PACK,
  DEFAULT_TAPE_PACK,
  PAPER_PACKS,
  PAPER_PACK_KEYS,
  TAPE_PACKS,
  TAPE_PACK_KEYS,
  TAPE_TONES,
  isBackgroundKey,
  isPaperPackKey,
  isTapePackKey,
  mascotVars,
  motifOf,
  pageLayers,
  paperVars,
  stationeryCss,
  stationeryOf,
  tapeVars,
} from "./stationery.ts";
import { DEFAULT_MASCOT, MASCOT_KEYS } from "./stickers.ts";
import { GINGHAM_RESOLVED, PRESET_PAPERS, busiestPage, contrastRatio, normalizeHex, previewTheme } from "./theme.ts";

const copy = JSON.parse(readFileSync("src/content/copy.json", "utf8"));
const NOTHING = { preset: null, accent: null };

test("a loop that chose nothing adds no CSS at all, however the choices are spelled", () => {
  assert.equal(stationeryCss(NOTHING), "");
  assert.equal(stationeryCss({ preset: "gingham", accent: null, background: DEFAULT_BACKGROUND, paperPack: DEFAULT_PAPER_PACK, tapePack: DEFAULT_TAPE_PACK, mascot: DEFAULT_MASCOT }), "");
  assert.equal(stationeryCss({ ...NOTHING, background: null, paperPack: null, tapePack: null, mascot: null }), "");
});

test("a key that isn't ours is ignored rather than written into the page", () => {
  const hostile = "x}</style><script>alert(1)</script>";
  assert.equal(stationeryCss({ ...NOTHING, background: hostile, paperPack: hostile, tapePack: hostile, mascot: hostile }), "");
  assert.deepEqual(mascotVars(hostile), { "--mascot-image": "initial", "--mascot-cherries": "initial" });
  assert.deepEqual(paperVars(hostile), paperVars(DEFAULT_PAPER_PACK));
  assert.deepEqual(tapeVars(hostile), tapeVars(DEFAULT_TAPE_PACK));
});

test("each choice stands alone: moving one leaves the others on the stylesheet's own", () => {
  const page = stationeryCss({ ...NOTHING, background: "hearts" });
  assert.match(page, /html\[data-theme="light"\]\{--page-image:url\("data:image\/svg\+xml,/);
  assert.match(page, /html\[data-theme="dark"\]\{--page-image:/);
  assert.doesNotMatch(page, /--paper-|--tape-|--mascot-|--accent:/);

  const paper = stationeryCss({ ...NOTHING, paperPack: "journal" });
  assert.match(paper, /^html\{--paper-answer:/);
  assert.doesNotMatch(paper, /--page-image|--tape-|--mascot-/);

  const tape = stationeryCss({ ...NOTHING, tapePack: "seaside" });
  assert.match(tape, /--tape-dots:/);
  assert.doesNotMatch(tape, /--paper-|--page-image|--mascot-/);

  const mascot = stationeryCss({ ...NOTHING, mascot: "frog" });
  assert.equal(mascot, 'html{--mascot-image:url("/stickers/frog.svg");--mascot-cherries:0}');
});

test("colours come through alongside everything else", () => {
  const css = stationeryCss({ preset: "meadow", accent: null, background: "dots", tapePack: "candy" });
  assert.match(css, /--page:#f0f6ec/);
  assert.match(css, /--page-image:/);
  assert.match(css, /--tape-stripe:/);
});

test("nothing inlined can close the style tag", () => {
  for (const background of BACKGROUND_KEYS) {
    for (const paperPack of PAPER_PACK_KEYS) {
      for (const tapePack of TAPE_PACK_KEYS) {
        const css = stationeryCss({ preset: "lilac", accent: "#336699", background, paperPack, tapePack, mascot: "bee" });
        assert.doesNotMatch(css, /<|>/, `${background}/${paperPack}/${tapePack}`);
      }
    }
  }
});

test("stationery is read from the loop's columns", () => {
  assert.deepEqual(
    stationeryOf({ themePreset: "lilac", themeAccent: "#123456", themeBackground: "dots", themePaperPack: "airmail", themeTapePack: "kraft", themeMascot: "bee" }),
    { preset: "lilac", accent: "#123456", background: "dots", paperPack: "airmail", tapePack: "kraft", mascot: "bee", divider: null },
  );
  assert.equal(stationeryOf({ themePreset: null, themeAccent: null, themeBackground: null, themePaperPack: null, themeTapePack: null, themeMascot: null, divider: "lace" }).divider, "lace");
});

test("a divider adds its own rule per scheme, and the stitches add nothing", () => {
  const plain = { preset: null, accent: null };
  assert.equal(stationeryCss({ ...plain, divider: null }), "");
  assert.equal(stationeryCss({ ...plain, divider: "zigzag" }), "");
  const css = stationeryCss({ ...plain, divider: "ricrac" });
  assert.match(css, /^html\[data-theme="light"\]\{--divider:url\(/);
  assert.match(css, /html\[data-theme="dark"\]\{--divider:url\(/);
});

test("the key checks accept their own tables and nothing else", () => {
  for (const [check, keys] of [[isBackgroundKey, BACKGROUND_KEYS], [isPaperPackKey, PAPER_PACK_KEYS], [isTapePackKey, TAPE_PACK_KEYS]] as const) {
    for (const key of keys) assert.equal(check(key), true, key);
    assert.equal(check("comic-sans"), false);
    assert.equal(check(null), false);
    assert.equal(check(7), false);
  }
});

test("every choice has words for the person choosing it", () => {
  for (const key of BACKGROUND_KEYS) assert.ok(copy.stationery.backgrounds[key], key);
  for (const key of PAPER_PACK_KEYS) {
    assert.ok(copy.stationery.packs[key].name, key);
    assert.ok(copy.stationery.packs[key].description, key);
  }
  for (const key of TAPE_PACK_KEYS) assert.ok(copy.stationery.tapes[key], key);
});

test("the original tape pack is the stylesheet's own, and every other pack fills all four tones", () => {
  assert.equal(TAPE_PACKS[DEFAULT_TAPE_PACK], null);
  assert.deepEqual(tapeVars(DEFAULT_TAPE_PACK), { "--tape-dots": "initial", "--tape-stripe": "initial", "--tape-mint": "initial", "--tape-check": "initial" });
  for (const key of TAPE_PACK_KEYS.filter((pack) => pack !== DEFAULT_TAPE_PACK)) {
    for (const tone of TAPE_TONES) assert.ok(TAPE_PACKS[key]?.[tone], `${key} ${tone}`);
    assert.notEqual(tapeVars(key)["--tape-dots"], "initial");
  }
});

test("a pack's variables say exactly what it does, and Plain cream resets a preview to nothing", () => {
  const cream = paperVars(DEFAULT_PAPER_PACK);
  assert.ok(Object.values(cream).every((value) => value === "initial"));

  const school = paperVars("schoolbook");
  assert.equal(school["--paper-answer"], "initial", "ruled answers rule the words, not the card");
  assert.match(school["--answer-lines"], /1lh/);
  assert.equal(school["--paper-margin"], "initial", "a notebook keeps its margin");
  assert.equal(school["--field-wash"], "initial");

  const journal = paperVars("journal");
  assert.notEqual(journal["--paper-answer"], "initial");
  assert.equal(journal["--paper-margin"], "transparent");
  assert.equal(journal["--field-wash"], "var(--card)");
  assert.equal(journal["--answer-lines"], "initial");
});

test("every texture is layers ending in a comma, ready for the card's colour to follow", () => {
  for (const [key, pack] of Object.entries(PAPER_PACKS)) {
    for (const surface of ["answer", "poll", "music", "note"] as const) {
      const layers = pack[surface];
      if (layers) assert.match(layers, /,$/, `${key} ${surface}`);
    }
  }
});

test("mascots swap the mark's art; the cherries are the mark", () => {
  assert.deepEqual(mascotVars(DEFAULT_MASCOT), { "--mascot-image": "initial", "--mascot-cherries": "initial" });
  for (const key of MASCOT_KEYS.filter((mascot) => mascot !== DEFAULT_MASCOT)) {
    assert.equal(mascotVars(key)["--mascot-image"], `url("/stickers/${key}.svg")`);
  }
});

test("gingham reads the check colour straight; every other pattern is an image in that scheme's colour", () => {
  const gingham = pageLayers(DEFAULT_BACKGROUND, GINGHAM_RESOLVED.light);
  assert.match(gingham.image, /linear-gradient\(90deg, rgb\(236 118 148/);
  assert.equal(gingham.size, "32px 32px");

  const light = pageLayers("stars", GINGHAM_RESOLVED.light);
  const dark = pageLayers("stars", GINGHAM_RESOLVED.dark);
  assert.notEqual(light.image, dark.image);
  assert.equal(light.size, "72px 72px");
  assert.match(decodeURIComponent(pageLayers("graph", GINGHAM_RESOLVED.light).image), /stroke='rgb\(236,118,148\)'/);
  assert.match(decodeURIComponent(light.image), /fill='rgb\(236,118,148\)'/);
});

/** Lay a colour with some opacity over a hex: what a translucent line really looks like on the paper. */
function over(base: string, [r, g, b]: number[], alpha: number): string {
  const channels = [1, 3, 5].map((start) => Number.parseInt(base.slice(start, start + 2), 16));
  return `#${channels.map((channel, index) => Math.round(channel * (1 - alpha) + [r, g, b][index] * alpha).toString(16).padStart(2, "0")).join("")}`;
}

test("no pattern is stronger than where gingham's stripes cross, the colour contrast was proved against", () => {
  const themes = ["gingham", ...Object.keys(PRESET_PAPERS)].map((preset) => previewTheme({ preset, accent: null }));
  for (const theme of themes) {
    for (const tokens of [theme.light, theme.dark]) {
      const { color, opacity } = motifOf(tokens.check);
      const rgb = color.match(/\d+/g)!.map(Number);
      const layered = over(tokens.page, rgb, opacity);
      const busiest = normalizeHex(busiestPage(tokens.page, tokens.check))!;
      // Rounded differently along the way, so within a whisker rather than identical.
      assert.ok(contrastRatio(layered, busiest) < 1.02, `${layered} vs ${busiest}`);
      assert.ok(contrastRatio(tokens.accentInk, layered) >= 4.4, `${tokens.accentInk} on ${layered}`);
    }
  }
});

test("words stay readable across a paper's hairlines, in every colour scheme", () => {
  const themes = ["gingham", ...Object.keys(PRESET_PAPERS)].map((preset) => previewTheme({ preset, accent: null }));
  for (const theme of themes) {
    for (const tokens of [theme.light, theme.dark]) {
      // --texture-line is --rule at 72%. A translucent rule is laid over the card first.
      const parts = tokens.rule.match(/[\d.]+/g)!.map(Number);
      const hairline = tokens.rule.startsWith("#")
        ? over(tokens.card, [1, 3, 5].map((start) => Number.parseInt(tokens.rule.slice(start, start + 2), 16)), 0.72)
        : over(tokens.card, parts.slice(0, 3), parts[3] * 0.72);
      for (const ink of [tokens.ink, tokens.inkSoft]) {
        assert.ok(contrastRatio(ink, hairline) >= 4.5, `${ink} on ${hairline}`);
      }
    }
  }
});
