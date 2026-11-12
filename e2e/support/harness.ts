import { expect, type Locator, type Page } from "@playwright/test";
import { latestOutbox, linkFrom } from "./db";
import { AFTER_FIRST_SLOT, BEFORE_FIRST_SLOT, DAY, DELIVERY_DAY, E2E_NOW, HOUR } from "./clock";
import { copy, copyPattern, text } from "@/lib/copy";

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
  await page.getByLabel(copy.signIn.emailLabel).fill(email);
  await page.getByRole("button", { name: copy.signIn.submit }).click();
  await expect(page).toHaveURL(/\/signin\/check-email$/);

  const mail = await latestOutbox("signin:");
  if (!mail) throw new Error("No sign-in email was queued");
  await page.goto(linkFrom(mail.html, "/signin/confirm"));
  await page.getByRole("button", { name: copy.emails.signIn.cta }).click();
  await expect(page).toHaveURL(/\/you$/);
}

/** A Picker trigger is named "Day: Friday": match the label, then the colon. */
export function triggerName(label: string): RegExp {
  return new RegExp(`^${copyPattern(label).source}:`);
}

/** Copy and pattern pieces in order: strings match as written (placeholders as any text), RegExps as patterns. */
export function inOrder(...parts: (string | RegExp)[]): RegExp {
  return new RegExp(parts.map((part) => (typeof part === "string" ? copyPattern(part).source : part.source)).join(""));
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
  await page.getByRole("button", { name: triggerName(triggerLabel) }).click();
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

/** On a phone a card's photo, video, voice and link buttons fold behind one: open the first card's. */
export async function showAttachments(scope: Page | Locator): Promise<void> {
  const toggle = scope.getByRole("button", { name: copy.reply.addAttachment }).first();
  if (await toggle.isVisible()) await toggle.click();
}

/**
 * Open what the stationery hides: the rarer touches wait behind "More touches", and a wide screen
 * then shows every group. On a phone only one group is open at a time, so there ask for the one
 * you need with `unfoldLook`.
 */
export async function unfoldLooks(page: Page): Promise<void> {
  const more = page.locator("details.look-more").first();
  if ((await more.count()) > 0) {
    await expect(async () => {
      if ((await more.getAttribute("open")) === null) await more.locator(":scope > summary").click();
      await expect(more).toHaveAttribute("open", "", { timeout: 1000 });
    }).toPass();
  }
  if ((page.viewportSize()?.width ?? 0) < 640) return;
  const folded = page.locator("details.look-group:not([open]) > summary");
  while ((await folded.count()) > 0) await folded.first().click();
}

/** Open one stationery group by its title ("Tape", "Seal or postmark"…), and "More touches" if it sits there. */
export async function unfoldLook(page: Page, legend: string): Promise<void> {
  const exact = new RegExp(`^${legend.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  const title = page.locator("details.look-group > summary .look-group__title").filter({ hasText: exact });
  if ((await title.count()) === 0) await unfoldLooks(page);
  const details = title.locator("xpath=ancestor::details[contains(@class,'look-group')][1]");
  await expect(async () => {
    if ((await details.getAttribute("open")) === null) await title.click();
    await expect(details).toHaveAttribute("open", "", { timeout: 1000 });
  }).toPass();
}

/** The accent's hex field, behind the "Custom color" tile until that is opened. */
export async function accentField(page: Page): Promise<Locator> {
  await unfoldLook(page, copy.stationery.paperLegend);
  const field = page.getByLabel(copy.stationery.accentInput);
  if ((await field.count()) === 0) await page.locator("button.custom-tile").click();
  await expect(field).toBeVisible();
  return field;
}

/** Choose an option in a picker inside `scope`, for when the page holds more than one with that name. */
export async function pickIn(scope: Locator, page: Page, triggerLabel: string, option: string): Promise<void> {
  await scope.getByRole("button", { name: triggerName(triggerLabel) }).click();
  const sheet = page.locator(".picker-sheet");
  const list = (await sheet.count()) > 0 ? sheet : page.locator(".picker-popover");
  await list.getByRole("option", { name: option, exact: true }).click();
}

export type CardItem = {
  text?: string;
  /** A label from copy.questions.item.formats, frequencies and dateKinds. */
  format?: string;
  frequency?: string;
  dateKind?: string;
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
  return page.locator("#add-item");
}

/** On a phone the add card stays folded until its button is tapped; a wide screen shows it. */
export async function openAddCard(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: copy.questions.add.open });
  if ((await toggle.count()) > 0 && (await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
}

/** Fill the item fields in `scope` (the add card, or an open row's editor). */
export async function fillItem(page: Page, scope: Locator, item: CardItem): Promise<void> {
  if (await scope.evaluate((element) => element.id === "add-item")) await openAddCard(page);
  if (item.format) await pickIn(scope, page, copy.questions.item.formatLabel, item.format);
  if (item.frequency) await pickIn(scope, page, copy.questions.item.frequencyLabel, item.frequency);
  if (item.dateKind) await pickIn(scope, page, copy.questions.item.dateKindLabel, item.dateKind);
  if (item.person) await pickIn(scope, page, copy.questions.item.personLabel, item.person);
  if (item.text !== undefined) await scope.getByLabel(copyPattern(copy.questions.item.textLabel, { start: true })).fill(item.text);
  if (item.date) await scope.getByLabel(copyPattern(copy.questions.item.dateLabel, { start: true })).fill(item.date);
  for (const [index, option] of (item.options ?? []).entries()) {
    const optionLabel = text(copy.polls.authoring.optionLabel, { number: index + 1 });
    if (index >= 2 && (await scope.getByLabel(optionLabel).count()) === 0) await scope.getByRole("button", { name: copy.polls.authoring.addOption }).click();
    await scope.getByLabel(copyPattern(optionLabel, { start: true })).fill(option);
  }
  if (item.multiple) await scope.getByLabel(copy.polls.authoring.multipleLabel).check();
  if (item.emoji !== undefined || item.description !== undefined || item.adminOnly !== undefined) {
    await unfoldIn(scope, copy.questions.item.optionsSummary);
    if (item.emoji !== undefined) await scope.getByLabel(copy.questions.item.emojiLabel).fill(item.emoji);
    if (item.description !== undefined) await scope.getByLabel(copy.questions.item.descriptionLabel).fill(item.description);
    if (item.adminOnly !== undefined) await scope.getByLabel(copy.questions.item.adminOnly).setChecked(item.adminOnly);
  }
}

/** Add an item with the add card and wait for the page to say so. */
export async function addWithCard(page: Page, item: CardItem): Promise<void> {
  const card = addCard(page);
  await fillItem(page, card, item);
  if (item.thisRound !== undefined) await card.getByLabel(copy.questions.add.thisRound).setChecked(item.thisRound);
  await card.getByRole("button", { name: copy.questions.add.submit, exact: true }).click();
  const added = [copy.questions.done.added, copy.questions.done.addedNow].map((notice) => copyPattern(notice).source).join("|");
  await expect(page.getByRole("status").filter({ hasText: new RegExp(`^(${added})`) })).toBeVisible();
}

/** Open a row's editor in place (the first row with that label, in This round or Up next). */
export async function openItem(page: Page, label: string, nth = 0): Promise<Locator> {
  // A row's button is named by what it shows, after "Edit": its number if it has one, its words, then its tags (which follow without a space).
  const name = `${copyPattern(copy.questions.item.editPrefix).source} \\d*${copyPattern(label).source}`;
  const toggle = page.getByRole("button", { name: new RegExp(`^${name}`) }).nth(nth);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  return toggle.locator("xpath=ancestor::li[1]");
}

/** Open the folded details with this summary text inside `scope`, unless it is already open. */
export async function unfoldIn(scope: Locator, summaryText: string | RegExp): Promise<void> {
  const summary = scope.locator("summary").filter({ hasText: summaryText }).first();
  const details = summary.locator("xpath=ancestor::details[1]");
  // A fold can also close itself just after hydration (Your loops folds its account parts on a
  // phone), so keep checking until it is open and stays open.
  await expect(async () => {
    if ((await details.getAttribute("open")) === null) await summary.click();
    await expect(details).toHaveAttribute("open", "", { timeout: 1_000 });
  }).toPass();
}

/** Open the folded details with this summary text, unless it is already open. */
export async function unfold(page: Page, summaryText: string | RegExp): Promise<void> {
  const summary = page.locator("summary").filter({ hasText: summaryText }).first();
  const details = summary.locator("xpath=ancestor::details[1]");
  // A fold can also close itself just after hydration (Your loops folds its account parts on a
  // phone), so keep checking until it is open and stays open.
  await expect(async () => {
    if ((await details.getAttribute("open")) === null) await summary.click();
    await expect(details).toHaveAttribute("open", "", { timeout: 1_000 });
  }).toPass();
}

/** Press Send now on the overview and say yes to the question it asks first. */
export async function sendNow(page: Page): Promise<void> {
  await page.getByRole("button", { name: copy.loop.sendNow }).click();
  await page.getByRole("button", { name: copy.loop.sendNowConfirm }).click();
}
