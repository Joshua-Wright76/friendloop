import { expect, type Page } from "@playwright/test";
import { latestOutbox, linkFrom } from "./db";
import { AFTER_FIRST_SLOT, BEFORE_FIRST_SLOT, DAY, DELIVERY_DAY, E2E_NOW, HOUR } from "./clock";

export { AFTER_FIRST_SLOT, BEFORE_FIRST_SLOT, DAY, DELIVERY_DAY, E2E_NOW, HOUR };

export const APP = process.env.E2E_BASE_URL ?? "http://localhost:3100";
export const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-cron-secret";

/** Unique identity per test, so parallel workers never collide. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}@friendloop.test`;
}

export type EmailTransport = "outbox" | "resend";

/** Force one request down the provider path, or back to the captured outbox. */
export function transportHeaders(transport: EmailTransport): Record<string, string> {
  return { "x-e2e-email-transport": transport };
}

/**
 * Run the one scheduled entry point as if it were `at`. This is the fake clock:
 * the app reads `x-e2e-now` only when E2E=1.
 */
export async function runSweep(
  at: Date,
  options: { transport?: EmailTransport } = {},
): Promise<{
  opened: number;
  delivered: number;
  skipped: number;
  reminded: number;
  retried: number;
}> {
  const response = await fetch(`${APP}/api/cron/sweep`, {
    headers: {
      authorization: `Bearer ${CRON_SECRET}`,
      "x-e2e-now": at.toISOString(),
      ...(options.transport ? transportHeaders(options.transport) : {}),
    },
  });
  expect(response.status, "sweep endpoint should accept the cron secret").toBe(200);
  return (await response.json()) as {
    opened: number;
    delivered: number;
    skipped: number;
    reminded: number;
    retried: number;
  };
}

/** Browser requests also carry the fake clock, for pages that render deadlines. */
export function clockHeaders(at: Date) {
  return { "x-e2e-now": at.toISOString() };
}

/**
 * Put the page on the same instant its fixtures were built on.
 *
 * The server reads `x-e2e-now`; client components read `Date`, which
 * `page.clock.setFixedTime` pins without touching timers (autosave debounce
 * still runs). Without this pair a spec asserts against two different "now"s.
 */
export async function freezeClock(page: Page, at: Date): Promise<void> {
  await page.setExtraHTTPHeaders(clockHeaders(at));
  await page.clock.setFixedTime(at);
}

/** Walk the real sign-in path: request, read the email, confirm. */export async function signIn(page: Page, email: string): Promise<void> {
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
 * Choose an option in the app's custom Picker: click the trigger, then the
 * option. Triggers are labelled "Day: Friday", so match on the label prefix.
 */
export async function pickOption(
  page: Page,
  triggerLabel: string,
  option: string,
): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${triggerLabel}:`) }).click();
  const sheet = page.locator(".picker-sheet");
  const scope = (await sheet.count()) > 0 ? sheet : page;
  await scope.getByRole("option", { name: option, exact: true }).click();
}

/**
 * WebKit finishes `load` before React hydrates, and a fill that lands first is
 * wiped by the first controlled render. The textareas get their inline height from
 * the hydration ref callback, so that is the "the sheet is live" signal.
 */
export async function waitForSheet(page: Page): Promise<void> {
  await expect(page.locator("textarea").first()).toHaveAttribute("style", /height:\s*\d+px/);
}
