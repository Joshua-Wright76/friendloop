#!/usr/bin/env node
/**
 * Renders the wax seal for every mascot in every wax colour, and the postage stamp
 * for every mascot, to public/seals/*.png for email, where SVG and filters don't
 * reliably show. The drawings are the web's own (src/lib/seal-art.ts). Run it after
 * changing a seal, a wax colour or a mascot:
 *
 *   node scripts/render-seals.mjs
 *
 * Each is drawn at twice its email size, for sharp screens, on a transparent ground.
 * The stamp wears plain kraft rather than any loop's colours, since one picture goes
 * to every loop; the round and the day are written beside it as real text.
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { EMAIL_SEAL_SIZE, EMAIL_STAMP, emailSealImages, stampSvg, waxSealSvg } from "../src/lib/seal-art.ts";

const OUT = "public/seals";
const SCALE = 2;
const STAMP_PAPER = "--stamp-paper:#fffdf7;--accent-soft:#f3eadb;--accent-line:#d8c6a8;--accent-ink:#7a5a2e";

const sticker = (key) => `data:image/svg+xml;base64,${readFileSync(`public/stickers/${key}.svg`, "base64")}`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: SCALE });

for (const image of emailSealImages()) {
  const wax = image.kind === "wax";
  const width = wax ? EMAIL_SEAL_SIZE : EMAIL_STAMP.width;
  const height = wax ? EMAIL_SEAL_SIZE : EMAIL_STAMP.height;
  const art = wax
    ? waxSealSvg({ mascotHref: sticker(image.mascot), color: image.color, id: "seal", seed: image.mascot })
    : stampSvg({ mascotHref: sticker(image.mascot), id: "stamp" });
  await page.setViewportSize({ width, height });
  await page.setContent(
    // A little room inside the edge, so the seal's shadow isn't cut off.
    `<!doctype html><style>body{margin:0;background:transparent;${STAMP_PAPER}}svg{display:block;width:${width - 4}px;height:${height - 4}px;margin:2px;overflow:visible}</style><body>${art}</body>`,
    { waitUntil: "load" },
  );
  await page.waitForFunction(() => [...document.images].every((img) => img.complete));
  await page.screenshot({ path: join("public", image.path), omitBackground: true });
}

await browser.close();
console.log(`rendered ${emailSealImages().length} seals and stamps to ${OUT}`);
