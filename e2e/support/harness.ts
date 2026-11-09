import { expect, type Locator, type Page } from "@playwright/test";
import { latestOutbox, linkFrom } from "./db";
import { AFTER_FIRST_SLOT, BEFORE_FIRST_SLOT, DAY, DELIVERY_DAY, E2E_NOW, HOUR } from "./clock";

export { AFTER_FIRST_SLOT, BEFORE_FIRST_SLOT, DAY, DELIVERY_DAY, E2E_NOW, HOUR };

export const APP = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3100}`;
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
  carried: number;
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
    carried: number;
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
  const label = triggerLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
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

/** The HTML body of the newest email whose dedupe key starts with `prefix`. */
export async function latestOutboxBody(prefix: string): Promise<string> {
  return (await latestOutbox(prefix)).html;
}

/**
 * Open one part of a page split by a segmented control ("The pool", "Add more",
 * "Stationery"…). The parts switch on the client, so a click that lands before hydration
 * does nothing: retry until the control says it took.
 */
export async function openPart(page: Page, name: string): Promise<void> {
  const part = page.getByRole("button", { name, exact: true });
  await expect(async () => {
    await part.click();
    await expect(part).toHaveAttribute("aria-pressed", "true", { timeout: 500 });
  }).toPass();
}

/** Choose an option in a picker inside `scope`, for when the page holds more than one with that name. */
export async function pickIn(scope: Locator, page: Page, triggerLabel: string, option: string): Promise<void> {
  const label = triggerLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await scope.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  const sheet = page.locator(".picker-sheet");
  const list = (await sheet.count()) > 0 ? sheet : page.locator(".picker-popover");
  await list.getByRole("option", { name: option, exact: true }).click();
}

export type CardItem = {
  text?: string;
  format?: "Written" | "Poll" | "Photo wall" | "Music link";
  frequency?: "Takes turns" | "Every round" | "On a date";
  dateKind?: "A one-time event" | "A birthday, every year";
  person?: string;
  date?: string;
  options?: string[];
  multiple?: boolean;
  emoji?: string;
  description?: string;
  adminOnly?: boolean;
  thisRound?: boolean;
};

/** The Questions page's one add card. */
export function addCard(page: Page): Locator {
  return page.getByRole("region", { name: "Add something to ask" });
}

/** Fill the item fields in `scope` (the add card, or an open row's editor). */
export async function fillItem(page: Page, scope: Locator, item: CardItem): Promise<void> {
  if (item.format) await pickIn(scope, page, "Answer with", item.format);
  if (item.frequency) await pickIn(scope, page, "How often", item.frequency);
  if (item.dateKind) await pickIn(scope, page, "Which kind of date", item.dateKind);
  if (item.person) await pickIn(scope, page, "Whose birthday?", item.person);
  if (item.text !== undefined) await scope.getByLabel(/^What to ask/).fill(item.text);
  if (item.date) await scope.getByLabel(/^Date/).fill(item.date);
  for (const [index, option] of (item.options ?? []).entries()) {
    if (index >= 2 && (await scope.getByLabel(`Option ${index + 1}`).count()) === 0) await scope.getByRole("button", { name: "Add option" }).click();
    await scope.getByLabel(new RegExp(`^Option ${index + 1}\\b`)).fill(option);
  }
  if (item.multiple) await scope.getByLabel("People can pick more than one").check();
  if (item.emoji !== undefined || item.description !== undefined || item.adminOnly !== undefined) {
    await unfoldIn(scope, "Emoji, description, and who answers");
    if (item.emoji !== undefined) await scope.getByLabel("Emoji").fill(item.emoji);
    if (item.description !== undefined) await scope.getByLabel("Description").fill(item.description);
    if (item.adminOnly !== undefined) await scope.getByLabel("Only the owner and admins answer this").setChecked(item.adminOnly);
  }
}

/** Add an item with the add card and wait for the page to say so. */
export async function addWithCard(page: Page, item: CardItem): Promise<void> {
  const card = addCard(page);
  await fillItem(page, card, item);
  if (item.thisRound !== undefined) await card.getByLabel("Ask it this round too").setChecked(item.thisRound);
  await card.getByRole("button", { name: "Add question", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Added/ })).toBeVisible();
}

/** Open a row's editor in place (the first row with that label, in This round or Up next). */
export async function openItem(page: Page, label: string, nth = 0): Promise<Locator> {
  // A row's button is named by what it shows, after "Edit": its words, then its tags.
  const words = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const toggle = page.getByRole("button", { name: new RegExp(`^Edit ${words}(\\s|$)`) }).nth(nth);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  return toggle.locator("xpath=ancestor::li[1]");
}

/** Open the folded details with this summary text inside `scope`, unless it is already open. */
export async function unfoldIn(scope: Locator, summaryText: string | RegExp): Promise<void> {
  const summary = scope.locator("summary").filter({ hasText: summaryText }).first();
  const details = summary.locator("xpath=ancestor::details[1]");
  if ((await details.getAttribute("open")) === null) await summary.click();
  await expect(details).toHaveAttribute("open", "");
}

/** Open the folded details with this summary text, unless it is already open. */
export async function unfold(page: Page, summaryText: string | RegExp): Promise<void> {
  const summary = page.locator("summary").filter({ hasText: summaryText }).first();
  const details = summary.locator("xpath=ancestor::details[1]");
  if ((await details.getAttribute("open")) === null) await summary.click();
  await expect(details).toHaveAttribute("open", "");
}

/** Press Send now on the overview and say yes to the question it asks first. */
export async function sendNow(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Send now" }).click();
  await page.getByRole("button", { name: "Yes, send it now" }).click();
}
