#!/usr/bin/env node
/**
 * Renders every divider, in every preset's light colours, to
 * public/dividers/email/*.png. Email can't lay an SVG along an answer's edge the way
 * the web does, but most clients repeat a PNG strip. Run it after changing a divider
 * or a preset's colours:
 *
 *   node scripts/render-email-dividers.mjs
 *
 * Strips are drawn at twice their size, for sharp screens, on a transparent ground.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { emailDividerStrips } from "../src/lib/dividers.ts";

const OUT = "public/dividers/email";
const SCALE = 2;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: SCALE });

for (const strip of emailDividerStrips()) {
  await page.setViewportSize({ width: strip.width, height: strip.height });
  await page.setContent(
    `<!doctype html><style>body{margin:0;background:transparent}svg{display:block}</style><body>${strip.svg}</body>`,
    { waitUntil: "load" },
  );
  await page.screenshot({ path: join("public", strip.path), omitBackground: true });
}

await browser.close();
console.log(`rendered ${emailDividerStrips().length} divider strips to ${OUT}`);
