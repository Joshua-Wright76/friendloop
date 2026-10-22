#!/usr/bin/env node
/**
 * Keeps a served decision page alive.
 *
 * The impeccable question server exits when the page stops sending heartbeats —
 * which happens the moment nobody has it open. This holds a headless browser on
 * the page so the round survives while the link is shared around.
 *
 *   node scripts/keepalive.mjs http://127.0.0.1:61840/
 */
import { chromium } from "@playwright/test";

const url = process.argv[2];
if (!url) {
  console.error("usage: node scripts/keepalive.mjs <url>");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(url, { waitUntil: "domcontentloaded" });
console.log(`keepalive: holding ${url}`);

const stop = async () => {
  await browser.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

// Re-open if the page ever navigates away or the socket drops.
setInterval(async () => {
  try {
    if (page.isClosed()) throw new Error("closed");
    const title = await page.title();
    if (!title) throw new Error("blank");
  } catch {
    console.log("keepalive: page lost, reopening");
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
}, 30_000);
