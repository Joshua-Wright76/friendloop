import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_PRESET,
  GINGHAM_EMAIL,
  GINGHAM_RESOLVED,
  PRESET_PAPERS,
  THEME_COLORS,
  THEME_PRESET_KEYS,
  contrastRatio,
  cssVars,
  deriveAccent,
  emailPalette,
  isDefaultTheme,
  isPresetKey,
  normalizeHex,
  previewTheme,
  resolveTheme,
  themeColorFor,
  themeCss,
  type SchemeTokens,
} from "./theme.ts";

test("each theme has a background color and a lookup", () => {
  assert.equal(themeColorFor("light"), THEME_COLORS.light);
  assert.equal(themeColorFor("dark"), THEME_COLORS.dark);
  assert.notEqual(THEME_COLORS.light, THEME_COLORS.dark);
});

test("hex input is normalized or refused", () => {
  assert.equal(normalizeHex("#ABC"), "#aabbcc");
  assert.equal(normalizeHex("  3366CC "), "#3366cc");
  assert.equal(normalizeHex("#12345"), null);
  assert.equal(normalizeHex("red"), null);
  assert.equal(normalizeHex("#12345g"), null);
  assert.equal(normalizeHex(undefined), null);
  assert.equal(normalizeHex(7), null);
});

test("contrast ratios match the WCAG reference points", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(contrastRatio("#777777", "#777777"), 1);
  assert.ok(Math.abs(contrastRatio("#767676", "#ffffff") - 4.54) < 0.01);
});

test("presets are a closed list with Gingham first", () => {
  assert.equal(THEME_PRESET_KEYS[0], DEFAULT_PRESET);
  assert.deepEqual([...THEME_PRESET_KEYS].slice(1), Object.keys(PRESET_PAPERS));
  assert.ok(isPresetKey("meadow"));
  assert.ok(isPresetKey("gingham"));
  assert.ok(!isPresetKey("comic-sans"));
  assert.ok(!isPresetKey(null));
});

test("no theme and Gingham with no accent are the stylesheet itself", () => {
  assert.ok(isDefaultTheme({ preset: null, accent: null }));
  assert.ok(isDefaultTheme({ preset: "gingham", accent: null }));
  assert.ok(isDefaultTheme({ preset: null, accent: "not a colour" }));
  assert.ok(!isDefaultTheme({ preset: "lilac", accent: null }));
  assert.ok(!isDefaultTheme({ preset: null, accent: "#336699" }));
  assert.equal(resolveTheme({ preset: null, accent: null }), null);
  assert.equal(themeCss(null), "");
  assert.equal(emailPalette({ preset: null, accent: null }), GINGHAM_EMAIL);
});

/** Every pairing the interface actually draws, per scheme. */
function assertReadable(tokens: SchemeTokens, label: string) {
  const text = (fg: string, bg: string, min = 4.5) =>
    assert.ok(contrastRatio(fg, bg) >= min, `${label}: ${fg} on ${bg} is ${contrastRatio(fg, bg).toFixed(2)}, wants ${min}`);

  text(tokens.ink, tokens.page, 7);
  text(tokens.ink, tokens.card, 7);
  text(tokens.inkSoft, tokens.card);
  text(tokens.inkSoft, tokens.page);
  text(tokens.inkMuted, tokens.card);
  text(tokens.inkMuted, tokens.page);
  text(tokens.onAccent, tokens.accent);
  text(tokens.accentInk, tokens.card);
  text(tokens.accentInk, tokens.page);
  text(tokens.accentInk, tokens.accentSoft);
  text(tokens.ink, tokens.accentSoft);
  text(tokens.accent, tokens.card, 3);
  text(tokens.controlLine, tokens.card, 3);
  text(tokens.controlLine, tokens.field, 3);
}

test("every preset is readable in both schemes", () => {
  for (const key of Object.keys(PRESET_PAPERS)) {
    const resolved = resolveTheme({ preset: key, accent: null });
    assert.ok(resolved, key);
    assertReadable(resolved.light, `${key} light`);
    assertReadable(resolved.dark, `${key} dark`);
    assert.equal(resolved.adjusted, false, `${key}: a preset's own seed is never reported as adjusted`);
  }
});

test("any accent the owner picks ends up readable on every preset", () => {
  const picks = [
    "#ffffff", "#000000", "#ffff00", "#00ffff", "#ff00ff", "#808080", "#cc3456",
    "#112233", "#fafad2", "#0000ff", "#39ff14", "#d2691e", "#123", "#f0f",
  ];
  for (const preset of THEME_PRESET_KEYS) {
    for (const accent of picks) {
      const resolved = resolveTheme({ preset, accent });
      assert.ok(resolved, `${preset} ${accent}`);
      assertReadable(resolved.light, `${preset} ${accent} light`);
      assertReadable(resolved.dark, `${preset} ${accent} dark`);
    }
  }
});

test("a readable accent is kept, a hopeless one is adjusted and says so", () => {
  const kept = deriveAccent("#2f5fb5", "light");
  assert.equal(kept.accent, "#2f5fb5");
  assert.equal(kept.adjusted, false);

  const yellow = deriveAccent("#ffee00", "light");
  assert.equal(yellow.adjusted, true);
  assert.ok(contrastRatio(yellow.accent, "#ffffff") >= 4.5);

  const black = deriveAccent("#000000", "dark");
  assert.equal(black.adjusted, true);
  assert.ok(contrastRatio(black.accent, black.onAccent) >= 4.5);

  assert.equal(resolveTheme({ preset: "gingham", accent: "#ffee00" })?.adjusted, true);
  assert.equal(resolveTheme({ preset: "gingham", accent: "#cc3456" })?.adjusted, false);
});

test("a stored preset that no longer exists falls back to Gingham's paper", () => {
  const resolved = resolveTheme({ preset: "retired", accent: "#336699" });
  assert.ok(resolved);
  assert.equal(resolved.light.page, "#fff3f5");
  assert.equal(resolved.dark.page, "#241a20");
});

test("the generated stylesheet sets only colour and shadow tokens", () => {
  const css = themeCss(resolveTheme({ preset: "bluebell", accent: "#2f5fb5" }));
  assert.match(css, /^html\[data-theme="light"\]\{/);
  assert.match(css, /html\[data-theme="dark"\]\{/);
  assert.match(css, /--page:#eef3fb/);
  assert.match(css, /--accent:#2f5fb5/);
  for (const declaration of css.split(/[{};]/).filter((part) => part.startsWith("--"))) {
    const [name, value] = [declaration.slice(0, declaration.indexOf(":")), declaration.slice(declaration.indexOf(":") + 1)];
    assert.match(name, /^--[a-z-]+$/);
    assert.doesNotMatch(value, /[<>"'\\;{}]/, name);
  }
  assert.doesNotMatch(css, /font|url\(|@import/i);
});

test("a themed email palette carries the preset, a default one is untouched", () => {
  const palette = emailPalette({ preset: "meadow", accent: null });
  assert.equal(palette.page, "#f0f6ec");
  assert.match(palette.check, /^rgba\(90,160,100,0\.14\)$/);
  assert.match(palette.shadow, /rgba\(50,110,60,\.4\)/);
  assert.ok(contrastRatio(palette.onAccent, palette.accent) >= 4.5);
  assert.ok(contrastRatio(palette.muted, palette.card) >= 4.5);
  assert.equal(emailPalette({ preset: "gingham", accent: null }).accent, "#cc3456");
  assert.equal(emailPalette({ preset: "gingham", accent: "#336699" }).page, "#fff3f5");
});

test("the Gingham tokens the settings preview draws match the stylesheet that actually renders", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start));
  };
  const read = (source: string) =>
    Object.fromEntries([...source.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));

  const root = read(block(":root"));
  for (const [name, tokens, source] of [
    ["light", GINGHAM_RESOLVED.light, root],
    // Dark only restates what differs; the rest is inherited from :root.
    ["dark", GINGHAM_RESOLVED.dark, { ...root, ...read(block('html[data-theme="dark"]')) }],
  ] as const) {
    for (const [variable, value] of Object.entries(cssVars(tokens))) {
      if (variable.startsWith("--shadow")) continue;
      assert.equal(source[variable]?.toLowerCase(), value.toLowerCase(), `${name} ${variable}`);
    }
  }
});

test("a preview is the resolved theme, or Gingham when nothing is chosen", () => {
  assert.equal(previewTheme({ preset: null, accent: null }), GINGHAM_RESOLVED);
  assert.notEqual(previewTheme({ preset: "lilac", accent: null }), GINGHAM_RESOLVED);
  assert.equal(previewTheme({ preset: "lilac", accent: null }).light.page, "#f5f0fb");
  assertReadable(GINGHAM_RESOLVED.light, "gingham light");
  assertReadable(GINGHAM_RESOLVED.dark, "gingham dark");
});
