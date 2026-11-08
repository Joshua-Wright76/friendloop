#!/usr/bin/env node
/**
 * Renders every loop background pattern, in every preset's light colours, to
 * public/patterns/email/*.png. Email clients drop the SVG the app draws pages with,
 * but most show a PNG tile. Run it after changing a pattern or a preset's paper:
 *
 *   node scripts/render-email-patterns.mjs
 *
 * Tiles are drawn at twice their size, for sharp screens, on the preset's page colour.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { emailPatternTiles } from "../src/lib/stationery.ts";

const OUT = "public/patterns/email";
const SCALE = 2;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: SCALE });

for (const tile of emailPatternTiles()) {
  await page.setViewportSize({ width: tile.width, height: tile.height });
  await page.setContent(
    // A style block, not an attribute: the pattern's url() carries double quotes.
    `<!doctype html><style>body{margin:0;width:${tile.width}px;height:${tile.height}px;background-color:${tile.page};background-image:${tile.image};background-size:${tile.width}px ${tile.height}px}</style><body></body>`,
    { waitUntil: "load" },
  );
  await page.screenshot({ path: join("public", tile.path) });
}

await browser.close();
