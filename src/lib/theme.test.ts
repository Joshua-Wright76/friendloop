import { test } from "node:test";
import assert from "node:assert/strict";
import { THEME_COLORS, themeColorFor } from "./theme.ts";

test("each theme has a background color and a lookup", () => {
  assert.equal(themeColorFor("light"), THEME_COLORS.light);
  assert.equal(themeColorFor("dark"), THEME_COLORS.dark);
  assert.notEqual(THEME_COLORS.light, THEME_COLORS.dark);
});
