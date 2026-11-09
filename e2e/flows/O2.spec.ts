import { test, expect } from "@playwright/test";
import { latestOutbox, resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, DELIVERY_DAY, runSweep } from "../support/harness";
import { makePng } from "../support/audio";
import { chooseFile } from "../support/identity";
import { copy, text, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("O2 · the sweep puts an event in the round whose window holds it, and the group writes to it", async ({ page }) => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  // Alice's birthday falls in round 1 (2 to 9 Jan); a housewarming in February does not.
  await rows("insert into events (group_id, kind, emoji, month, day, membership_id) values ($1, 'birthday', '🎂', 1, 6, $2)", [loop.groupId, alice.id]);
  await rows("insert into events (group_id, kind, title, emoji, month, day, year) values ($1, 'once', 'The housewarming', '🏡', 2, 14, 2026)", [loop.groupId]);

  await runSweep(AFTER_FIRST_SLOT);
  const snapshots = await rows<{ title: string; emoji: string; event_date: string }>(
    "select text as title, emoji, occurrence_date::text as event_date from issue_questions where occurrence_date is not null order by position",
  );
  expect(snapshots).toEqual([{ title: text(copy.events.birthdayRow, { name: "Alice" }), emoji: "🎂", event_date: "2026-01-06" }]);

  // Bob sees it on his sheet, writes a message and adds a photo.
  await page.goto(`/r/${bob.token}`);
  // A birthday is a written card in the round, after the questions.
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: copyPattern(copy.events.section.birthdayTitle, { values: { name: "Alice" } }) }) });
  await expect(card.getByText("Leave Alice a note or a photo.")).toBeVisible();
  await page.getByRole("textbox", { name: text(copy.events.birthdayRow, { name: "Alice" }) }).fill("Happy birthday, Alice. Cake is on me.");
  await chooseFile(page, "Add a photo", { name: "cake.png", mimeType: "image/png", buffer: makePng() }, card);
  await expect(card.getByText(copy.reply.photoSaved).first()).toBeVisible();
  await page.getByRole("button", { name: copy.reply.done, exact: true }).click();
  await expect(page.getByRole("heading", { name: copy.reply.confirmation.title, exact: true })).toBeVisible();

  // Delivery carries the section in the email and on the web issue.
  await runSweep(DELIVERY_DAY);
  const email = await latestOutbox("delivery:");
  expect(email.html).toContain("Alice&#39;s birthday");
  expect(email.html).toContain("Happy birthday, Alice. Cake is on me.");

  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await page.goto(`/i/${issue.id}?m=${alice.token}`);
  await expect(page.getByRole("heading", { name: copyPattern(copy.events.section.birthdayTitle, { values: { name: "Alice" } }) })).toBeVisible();
  await expect(page.getByText("Happy birthday, Alice. Cake is on me.")).toBeVisible();
});
