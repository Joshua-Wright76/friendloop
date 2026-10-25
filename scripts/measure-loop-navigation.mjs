#!/usr/bin/env node
/** Measure click-to-rendered-content time for loop tabs against a production build. */
import { chromium } from "@playwright/test";
import postgres from "postgres";
import { createHash, randomBytes } from "node:crypto";

const baseURL = (process.env.E2E_BASE_URL ?? "http://localhost:3101").replace(/\/$/, "");
const groupId = process.env.LOOP_ID ?? "22222222-2222-4222-8222-222222222222";
const userId = process.env.LOOP_USER_ID ?? "22222222-2222-4222-8222-222222222223";
const cycles = Number(process.env.NAV_CYCLES ?? 3);
const budget = Number(process.env.NAV_BUDGET_MS ?? 100);
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("base64url");
const browser = await chromium.launch({ headless: true });

const tabs = [
  ["People", "members", "People"],
  ["Questions", "questions", "Questions"],
  ["Rounds", "issues", "Rounds"],
  ["Settings", "settings", "Settings"],
  ["Overview", "", null],
];

try {
  await sql`insert into sessions (user_id, token_hash, expires_at) values (${userId}, ${tokenHash}, ${new Date(Date.now() + 3600000)})`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "fl_session", value: token, url: baseURL }]);
  const page = await context.newPage();
  await page.goto(`${baseURL}/g/${groupId}`, { waitUntil: "networkidle" });
  const measurements = [];

  for (let cycle = 1; cycle <= cycles; cycle++) {
    for (const [label, path, heading] of tabs) {
      const start = performance.now();
      await page.getByRole("link", { name: label, exact: true }).click();
      await page.waitForURL(`**/g/${groupId}${path ? `/${path}` : ""}`);
      if (heading) await page.getByRole("heading", { name: heading, exact: true }).waitFor();
      else await page.locator("h1").first().waitFor();
      const elapsed = performance.now() - start;
      measurements.push({ cycle, label, elapsed });
      console.log(`cycle ${cycle} · ${label}: ${elapsed.toFixed(0)}ms`);
    }
  }

  const values = measurements.map((item) => item.elapsed).sort((a, b) => a - b);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const p95 = values[Math.min(values.length - 1, Math.floor(values.length * 0.95))];
  console.log(`\n${values.length} navigations · average ${average.toFixed(0)}ms · p95 ${p95.toFixed(0)}ms · budget ${budget}ms`);
  if (process.env.ENFORCE === "1" && average > budget) process.exitCode = 1;
} finally {
  await sql`delete from sessions where token_hash = ${tokenHash}`;
  await browser.close();
  await sql.end({ timeout: 5 });
}
