#!/usr/bin/env node
/**
 * Renders public/stickers/*.svg to public/stickers/png/*.png for email, where SVG
 * doesn't reliably show. Run it after changing a drawing:
 *
 *   node scripts/render-stickers.mjs
 *
 * Each sticker gets a white die-cut edge, because a mail client may lay it on anything.
 */
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const SOURCE = "public/stickers";
const OUT = join(SOURCE, "png");
const SIZE = 96;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });

for (const file of readdirSync(SOURCE).filter((name) => name.endsWith(".svg"))) {
  const svg = readFileSync(join(SOURCE, file), "base64");
  await page.setContent(
    `<!doctype html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${svg}" style="display:block;width:${SIZE - 8}px;height:${SIZE - 8}px;margin:4px;filter:drop-shadow(0 0 1.5px #fff) drop-shadow(0 0 1.5px #fff)"></body>`,
    { waitUntil: "load" },
  );
  await page.screenshot({ path: join(OUT, file.replace(/\.svg$/, ".png")), omitBackground: true });
}

await browser.close();
console.log(`rendered ${readdirSync(OUT).length} stickers to ${OUT}`);
