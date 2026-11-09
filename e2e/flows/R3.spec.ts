import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { APP, DELIVERY_DAY, HOUR, runSweep, signIn, waitForSheet } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

const OPENED = new Date("2026-01-02T08:00:00Z");

async function reminderRecipients() {
  const mail = await rows<{ to: string }>("select \"to\" from outbox where kind = 'reminder' order by \"to\"");
  return mail.map((row) => row.to);
}

const SWITCH = { name: "Remind me before it goes out" };

const preferenceOf = async (id: string) =>
  (await rows<{ reminder_preference: string }>("select reminder_preference from memberships where id = $1", [id]))[0]
    .reminder_preference;

test("R3 · a contributor turns their reminder off and on with one switch, and the choice sticks", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: OPENED });
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  await page.goto(`/r/${bob.token}`);
  await waitForSheet(page);
  const reminder = page.getByRole("switch", SWITCH);
  await expect(reminder).toBeChecked();
  // One switch, not a list of options that all do the same thing.
  await expect(page.locator("#reminders input")).toHaveCount(1);

  await reminder.uncheck();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(await preferenceOf(bob.id)).toBe("none");
  await page.reload();
  await waitForSheet(page);
  await expect(page.getByRole("switch", SWITCH)).not.toBeChecked();

  await page.getByRole("switch", SWITCH).check();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(await preferenceOf(bob.id)).toBe("all");

  // The control never promises more than the loop sends.
  await expect(page.getByText(/Whoever runs the loop can still nudge you/)).toBeVisible();
});

test("R3 · the reminder email points at the control, and the control is where it says", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: OPENED });
  await runSweep(new Date(DELIVERY_DAY.getTime() - 24 * HOUR));
  const [mail] = await rows<{ html: string; text: string }>(
    "select html, text from outbox where kind = 'reminder' order by \"to\" limit 1",
  );
  expect(mail.html).toContain("switch these reminders off at the bottom of your answer page");
  expect(mail.text).toContain("switch these reminders off at the bottom of your answer page");

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  await expect(page.getByRole("switch", SWITCH)).toBeVisible();
});

test("R3 · someone who chose \"only the last reminder\" before sees the switch on", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: OPENED });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await rows("update memberships set reminder_preference = 'last' where id = $1", [alice.id]);

  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  await expect(page.getByRole("switch", SWITCH)).toBeChecked();
});

test("R3 · the loop's reminder follows each choice, never repeats, and leaves the owner's nudge alone", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: OPENED });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  // Alice switches hers off through her page; Bob is on the old "last only", which means on.
  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  await page.getByRole("switch", SWITCH).uncheck();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await rows("update memberships set reminder_preference = 'last' where id = $1", [bob.id]);

  const at = new Date(issue.deliversAt.getTime() - 24 * HOUR);
  const first = await runSweep(at);
  expect(first.reminded).toBe(2);
  expect(await reminderRecipients()).toEqual(["bob@friendloop.test", "owner@friendloop.test"]);
  expect((await runSweep(at)).reminded, "a second run sends nothing").toBe(0);
  expect((await runSweep(new Date(at.getTime() + HOUR))).reminded).toBe(0);

  // The owner's nudge by hand still reaches Alice, who asked for none.
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}`);
  await page.getByRole("button", { name: /^Nudge .*Alice/ }).click();
  await page.getByRole("button", { name: "Send the nudge" }).click();
  await expect(page.getByText("2 nudges sent.")).toBeVisible();
  const nudged = await rows<{ to: string }>(
    "select \"to\" from outbox where kind = 'reminder' and dedupe_key like 'manual-reminder:%' order by \"to\"",
  );
  expect(nudged.map((row) => row.to)).toEqual(["alice@friendloop.test", "bob@friendloop.test"]);
});

test("R3 · a reader or a stranger cannot set one, and a bad value writes nothing", async () => {
  const loop = await seedLoop({
    members: [
      { email: "alice@friendloop.test", name: "Alice" },
      { email: "reader@friendloop.test", name: "Rae", participation: "reader" },
    ],
  });
  await seedOpenIssue(loop, { openedAt: OPENED });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const reader = loop.members.find((member) => member.email.startsWith("reader"))!;

  const post = (token: string, preference: unknown) =>
    fetch(`${APP}/api/reply/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reminders", preference }),
    });

  expect((await post(reader.token, "none")).status).toBe(403);
  expect((await post("not-a-token", "none")).status).toBe(404);
  expect((await post(alice.token, "weekly")).status).toBe(400);
  expect((await post(alice.token, undefined)).status).toBe(400);
  expect((await post(alice.token, true)).status).toBe(400);

  const stored = await rows<{ email: string; reminder_preference: string }>(
    "select email, reminder_preference from memberships where group_id = $1",
    [loop.groupId],
  );
  expect(stored.every((row) => row.reminder_preference === "all")).toBe(true);
  expect((await post(alice.token, "none")).status).toBe(200);
  // A page opened before the switch may still send the old "last": it is stored as on.
  expect((await post(alice.token, "last")).status).toBe(200);
  expect((await rows<{ reminder_preference: string }>("select reminder_preference from memberships where id = $1", [alice.id]))[0].reminder_preference).toBe("all");
});

test("R3 · opening the page or the email never changes a preference", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: OPENED });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await rows("update memberships set reminder_preference = 'none' where id = $1", [alice.id]);

  // A mail scanner fetching every link in the message is a GET; it must change nothing.
  for (const path of [`/r/${alice.token}`, `/r/${alice.token}#reminders`]) {
    expect((await fetch(`${APP}${path}`)).status).toBe(200);
  }
  const [row] = await rows<{ reminder_preference: string }>(
    "select reminder_preference from memberships where id = $1",
    [alice.id],
  );
  expect(row.reminder_preference).toBe("none");
});
