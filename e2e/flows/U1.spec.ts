import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue, seedDeliveredIssue } from "../support/seed";
import { APP, DELIVERY_DAY, HOUR, runSweep, signIn, waitForSheet } from "../support/harness";
import { copy, text as copyText } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

const OPENED = new Date("2026-01-02T08:00:00Z");

async function unsubscribeTokenOf(email: string): Promise<string> {
  const [row] = await rows<{ unsubscribe_token: string }>(
    "select unsubscribe_token from memberships where email = $1",
    [email],
  );
  return row.unsubscribe_token;
}

async function mutedAt(email: string): Promise<Date | null> {
  const [row] = await rows<{ muted_at: Date | null }>("select muted_at from memberships where email = $1", [email]);
  return row.muted_at;
}

test("U1 · loop emails carry one-click headers and a footer link; sign-in emails carry neither", async () => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: OPENED });
  await runSweep(new Date(DELIVERY_DAY.getTime() - 24 * HOUR));

  const bobToken = await unsubscribeTokenOf("bob@friendloop.test");
  const [reminder] = await rows<{ html: string; text: string; headers: Record<string, string> }>(
    "select html, text, headers from outbox where kind = 'reminder' and \"to\" = 'bob@friendloop.test'",
  );
  expect(reminder.headers).toEqual({
    "List-Unsubscribe": `<${APP}/api/unsubscribe/${bobToken}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  });
  expect(reminder.html).toContain(`href="${APP}/u/${bobToken}"`);
  expect(reminder.html).toContain(copy.emails.stopLink);
  expect(reminder.text).toContain(`Stop emails from this loop: ${APP}/u/${bobToken}`);

  // The unsubscribe token is not the reply credential.
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  expect(bobToken).not.toBe(bob.token);
});

test("U1 · the footer link asks first, mutes on confirm, and the member can turn emails back on", async ({ page, request }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: OPENED });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const token = await unsubscribeTokenOf(alice.email);

  // GET never mutates: neither the page nor the one-click URL opened in a browser.
  await page.goto(`/u/${token}`);
  await expect(page.getByRole("heading", { name: copyText(copy.unsubscribe.title, { groupName: "Friday Loop" }) })).toBeVisible();
  const viaHeader = await request.get(`/api/unsubscribe/${token}`, { maxRedirects: 0 });
  expect(viaHeader.status()).toBe(303);
  expect(viaHeader.headers()["location"]).toBe(`${APP}/u/${token}`);
  expect(await mutedAt(alice.email)).toBeNull();

  await page.getByRole("button", { name: copy.unsubscribe.confirm }).click();
  await expect(page.getByRole("heading", { name: copyText(copy.unsubscribe.mutedTitle, { groupName: "Friday Loop" }) })).toBeVisible();
  expect(await mutedAt(alice.email)).not.toBeNull();

  // Still in the loop: the reply link works and offers the way back.
  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  await expect(page.getByText(copy.unsubscribe.notice)).toBeVisible();

  // Muted: the loop's reminder is recorded but never sent.
  await runSweep(new Date(DELIVERY_DAY.getTime() - 24 * HOUR));
  const [held] = await rows<{ status: string; suppressed_reason: string }>(
    "select status, suppressed_reason from outbox where kind = 'reminder' and \"to\" = $1",
    [alice.email],
  );
  expect(held).toEqual({ status: "suppressed", suppressed_reason: "muted" });

  // The owner sees it on the people tab.
  const ownerPage = await page.context().browser()!.newPage();
  await signIn(ownerPage, "owner@friendloop.test");
  await ownerPage.goto(`/g/${loop.groupId}/members`);
  await expect(ownerPage.getByText(copy.members.muted)).toHaveCount(1);
  await ownerPage.close();

  await page.getByRole("button", { name: copy.unsubscribe.unmute }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${alice.token}$`));
  await waitForSheet(page);
  await expect(page.getByText(copy.unsubscribe.notice)).toHaveCount(0);
  expect(await mutedAt(alice.email)).toBeNull();
});

test("U1 · a one-click POST mutes with no confirmation, and an unknown token is refused", async ({ request, page }) => {
  const loop = await seedLoop();
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  const token = await unsubscribeTokenOf(bob.email);

  const response = await request.post(`/api/unsubscribe/${token}`, {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    data: "List-Unsubscribe=One-Click",
  });
  expect(response.status()).toBe(200);
  expect(await mutedAt(bob.email)).not.toBeNull();

  const unknown = await request.post(`/api/unsubscribe/${"0".repeat(64)}`, {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    data: "List-Unsubscribe=One-Click",
  });
  expect(unknown.status()).toBe(404);

  const nonsense = await request.post(`/api/unsubscribe/${token}`, {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    data: "action=explode",
  });
  expect(nonsense.status()).toBe(400);

  // The unsubscribe page offers the way back, and a bad link says so plainly.
  await page.goto(`/u/${token}`);
  await page.getByRole("button", { name: copy.unsubscribe.unmute }).click();
  await expect(page.getByRole("heading", { name: copyText(copy.unsubscribe.title, { groupName: "Friday Loop" }) })).toBeVisible();
  expect(await mutedAt(bob.email)).toBeNull();

  await page.goto(`/u/not-a-real-token`);
  await expect(page.getByRole("heading", { name: copy.unsubscribe.invalidTitle })).toBeVisible();
});

test("U1 · a muted member can turn emails back on from a delivered round", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: DELIVERY_DAY,
    answers: [{ email: "bob@friendloop.test", body: "Geese, again." }],
  });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await rows("update memberships set muted_at = now() where id = $1", [alice.id]);

  await page.goto(`/i/${issue.issueId}?m=${encodeURIComponent(alice.token)}`);
  await expect(page.getByText(copy.unsubscribe.notice)).toBeVisible();
  await page.getByRole("button", { name: copy.unsubscribe.unmute }).click();
  await expect(page).toHaveURL(new RegExp(`/i/${issue.issueId}\\?m=`));
  await expect(page.getByText(copy.unsubscribe.notice)).toHaveCount(0);
  expect(await mutedAt(alice.email)).toBeNull();
});
