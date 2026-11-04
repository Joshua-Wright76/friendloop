import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, DELIVERY_DAY, E2E_NOW, freezeClock, runSweep, signIn } from "../support/harness";

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
  await page.getByRole("button", { name: "Send answers" }).click();
  await expect(page.getByText("Sent").first()).toBeVisible();

  // Alice is renamed, then the owner edits the event to someone else's date and deletes it.
  await rows("update memberships set name = 'Alicia' where id = $1", [alice.id]);
  await signIn(page, "owner@friendloop.test");
  await freezeClock(page, E2E_NOW);
  await page.goto(`/g/${loop.groupId}/questions`);
  const item = page.getByRole("list", { name: "Events, soonest first" }).locator("> li").first();
  await expect(item).toContainText("Alicia's birthday"); // the list is live
  await item.getByText("Edit").click();
  await item.getByLabel("Date").fill("1990-05-05");
  await item.getByLabel("Icon").fill("🎈");
  await item.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Event saved.")).toBeVisible();
  await page.getByRole("button", { name: "Remove Alicia's birthday" }).click();
  await page.getByRole("button", { name: /^Yes, remove/ }).click(); // removing asks first
  await expect(page.getByText("Event removed.")).toBeVisible();

  // The open round still reads exactly as it was snapshotted.
  const snapshots = await rows<{ title: string; emoji: string; event_id: string | null; event_date: string }>(
    "select title, emoji, event_id, event_date::text as event_date from issue_sections",
  );
  expect(snapshots).toEqual([{ title: "Alice's birthday", emoji: "🎂", event_id: null, event_date: "2026-01-06" }]);
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
