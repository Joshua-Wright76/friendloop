import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, DELIVERY_DAY, E2E_NOW, freezeClock, openItem, runSweep, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("O4 · a round keeps the event section it was given, whatever happens to the event or the person later", async ({ page }) => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await rows("insert into events (group_id, kind, emoji, month, day, membership_id) values ($1, 'birthday', '🎂', 1, 6, $2)", [loop.groupId, alice.id]);
  await runSweep(AFTER_FIRST_SLOT);

  // Bob writes his message while the event still exists.
  await page.goto(`/r/${bob.token}`);
  await page.getByRole("textbox", { name: "Alice's birthday" }).fill("Many happy returns.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All set", exact: true })).toBeVisible();

  // Alice is renamed, then the owner edits the event to someone else's date and deletes it.
  await rows("update memberships set name = 'Alicia' where id = $1", [alice.id]);
  await signIn(page, "owner@friendloop.test");
  await freezeClock(page, E2E_NOW);
  await page.goto(`/g/${loop.groupId}/questions`);
  // The row in Up next is live; the card in this round keeps its title.
  await expect(page.getByRole("list", { name: "Events and birthdays, soonest first" })).toContainText("Alicia's birthday");
  const item = await openItem(page, "Alicia's birthday");
  await item.getByLabel(/^Date/).fill("1990-05-05");
  await item.getByLabel("Emoji").fill("🎈");
  await item.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  const again = await openItem(page, "Alicia's birthday");
  await again.getByRole("button", { name: "Stop asking: Alicia's birthday" }).click();
  await again.getByRole("button", { name: "Yes, stop asking" }).click(); // stopping asks first
  // Bob wrote in it, so this round keeps it.
  await expect(page.getByText("Stopped asking. Someone has written there this round, so this round keeps it.")).toBeVisible();

  // The open round still reads exactly as it was snapshotted.
  const snapshots = await rows<{ title: string; emoji: string; event_id: string | null; event_date: string }>(
    "select text as title, emoji, question_id as event_id, occurrence_date::text as event_date from issue_questions where occurrence_date is not null",
  );
  expect(snapshots.map((row) => ({ ...row, event_id: row.event_id !== null }))).toEqual([{ title: "Alice's birthday", emoji: "🎂", event_id: true, event_date: "2026-01-06" }]);
  await page.goto(`/r/${bob.token}`);
  await expect(page.getByRole("textbox", { name: "Alice's birthday" })).toHaveValue("Many happy returns.");

  // And so does the delivered issue.
  await runSweep(DELIVERY_DAY);
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await page.goto(`/i/${issue.id}?m=${alice.token}`);
  await expect(page.getByRole("heading", { name: /Alice's birthday/ })).toBeVisible();
  await expect(page.getByText("Many happy returns.")).toBeVisible();
  await expect(page.getByText("Alicia's birthday")).toHaveCount(0);
});
