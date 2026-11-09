import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { addWithCard, runSweep, signIn } from "../support/harness";
import { copy } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("K7 · owners-only items stay invisible to regular members", async ({ page }) => {
  const loop = await seedLoop();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await addWithCard(page, { text: "Committee notes", frequency: copy.questions.item.frequencies.every_round, adminOnly: true });
  await runSweep(new Date("2026-01-02T08:00:00Z"));
  const [section] = await rows<{ id: string }>("select id from issue_questions where text = 'Committee notes' limit 1");

  // Drop the owner's session before reading as Alice.
  await page.context().clearCookies();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  await expect(page.getByText("Committee notes")).toHaveCount(0);

  // The API refuses a member writing to a section it cannot even see.
  const refused = await page.request.post(`/api/reply/${alice.token}`, {
    data: { action: "sectionDraft", issueSectionId: section.id, body: "sneaky" },
  });
  expect(refused.status()).toBe(403);

  await runSweep(new Date("2026-01-09T09:00:00Z"));
  // Nobody answered round 1, so it was skipped and the loop paused. Carry on to round 2.
  await rows("update groups set paused_at = null where id = $1", [loop.groupId]);
  await runSweep(new Date("2026-01-09T09:00:00Z"));
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await page.goto(`/i/${issue.id}?m=${alice.token}`);
  await expect(page.getByText("Committee notes")).toHaveCount(0);

  // The owner, who contributes, still sees and answers it.
  await page.goto(`/r/${loop.ownerToken}`);
  await expect(page.getByText("Committee notes")).toBeVisible();
  await page.getByRole("textbox", { name: "Committee notes" }).fill("Budget looks fine.");
  await page.getByRole("button", { name: copy.reply.done, exact: true }).click();
  await expect(page.getByRole("heading", { name: copy.reply.confirmation.title, exact: true })).toBeVisible();

  // Once it goes out, the owner reads it; Alice still doesn't.
  await runSweep(new Date("2026-01-16T09:00:00Z"));
  const [second] = await rows<{ id: string }>("select id from issues where status = 'delivered' order by number desc limit 1");
  await page.goto(`/i/${second.id}?m=${loop.ownerToken}`);
  await expect(page.getByText("Budget looks fine.")).toBeVisible();
  await page.goto(`/i/${second.id}?m=${alice.token}`);
  await expect(page.getByText("Committee notes")).toHaveCount(0);
  await expect(page.getByText("Budget looks fine.")).toHaveCount(0);
});
