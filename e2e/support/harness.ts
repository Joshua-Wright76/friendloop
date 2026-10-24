import { expect, type Page } from "@playwright/test";
import { latestOutbox, linkFrom } from "./db";

export const APP = process.env.E2E_BASE_URL ?? "http://localhost:3100";
export const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-cron-secret";

/** Unique identity per test, so parallel workers never collide. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}@friendloop.test`;
}

/**
 * Run the one scheduled entry point as if it were `at`. This is the fake clock:
 * the app reads `x-e2e-now` only when E2E=1.
 */
export async function runSweep(at: Date): Promise<{
  opened: number;
  delivered: number;
  skipped: number;
  reminded: number;
}> {
  const response = await fetch(`${APP}/api/cron/sweep`, {
    headers: {
      authorization: `Bearer ${CRON_SECRET}`,
      "x-e2e-now": at.toISOString(),
    },
  });
  expect(response.status, "sweep endpoint should accept the cron secret").toBe(200);
  return (await response.json()) as {
    opened: number;
    delivered: number;
    skipped: number;
    reminded: number;
  };
}

/** Browser requests also carry the fake clock, for pages that render deadlines. */
export function clockHeaders(at: Date) {
  return { "x-e2e-now": at.toISOString() };
}

export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;

/** Thursday 07:59 UTC — the minute before a Friday 09:00 Amsterdam slot. */
export const BEFORE_FIRST_SLOT = new Date("2026-01-01T07:59:00Z");
export const AFTER_FIRST_SLOT = new Date("2026-01-02T08:05:00Z");
export const DELIVERY_DAY = new Date("2026-01-09T08:05:00Z");

/** Walk the real sign-in path: request, read the email, confirm. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/signin");
  await page.getByLabel("Your email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page).toHaveURL(/\/signin\/check-email$/);

  const mail = await latestOutbox("signin:");
  if (!mail) throw new Error("No sign-in email was queued");
  await page.goto(linkFrom(mail.html, "/signin/confirm"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/you$/);
}

/**
 * WebKit finishes `load` before React hydrates, and a fill that lands first is
 * wiped by the first controlled render. The textareas get their inline height from
 * the hydration ref callback, so that is the "the sheet is live" signal.
 */
export async function waitForSheet(page: Page): Promise<void> {
  await expect(page.locator("textarea").first()).toHaveAttribute("style", /height:\s*\d+px/);
}
