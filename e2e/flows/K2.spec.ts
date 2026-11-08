import { test, expect } from "@playwright/test";
import { db } from "@/db";
import { memberships } from "@/db/schema";
import { latestOutbox, resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { newToken } from "@/lib/tokens";
import { openPart, runSweep, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

async function addReader(groupId: string) {
  const token = newToken();
  const [row] = await db
    .insert(memberships)
    .values({
      groupId,
      email: "rita@friendloop.test",
      name: "Rita",
      participation: "reader",
      replyToken: token,
      acceptedAt: new Date("2026-01-01T00:00:00Z"),
    })
    .returning();
  return { id: row.id, token };
}

test("K2 · sections ride every issue; readers read but never answer", async ({ page }) => {
  const loop = await seedLoop();
  const reader = await addReader(loop.groupId);

  // The owner creates a standard section before anything opens.
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await openPart(page, "Sections and dates");
  await page.getByPlaceholder("The potluck corner").fill("The potluck corner");
  await page.getByRole("button", { name: "Add section" }).click();
  await expect(page.getByText("Section added.")).toBeVisible();

  // The sweep snapshots the section into the fresh issue.
  await runSweep(new Date("2026-01-02T08:00:00Z"));
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  await expect(page.getByText("And a little extra")).toBeVisible();
  await expect(page.getByText("The potluck corner")).toBeVisible();

  // A section answer is content; the round delivers it.
  await page.getByRole("textbox", { name: "The potluck corner" }).fill("Never too many dips.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All set", exact: true })).toBeVisible();

  // Deliver, then read: members see the section; readers see it too — read-only.
  await runSweep(new Date("2026-01-09T09:00:00Z"));
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await page.goto(`/i/${issue.id}?m=${alice.token}`);
  await expect(page.getByText("The potluck corner")).toBeVisible();

  await page.goto(`/i/${issue.id}?m=${reader.token}`);
  await expect(page.getByText("The potluck corner")).toBeVisible();

  // The delivery email mentions the section.
  const email = await latestOutbox("delivery:");
  expect(email.html).toContain("The potluck corner");
});

test("K2 · a round that holds only sections still sends every contributor its prompt", async () => {
  const loop = await seedLoop({ questions: [] });
  await addReader(loop.groupId);
  await rows("insert into sections (group_id, kind, title, emoji) values ($1, 'photo_wall', 'Photo wall', '📸')", [loop.groupId]);

  await runSweep(new Date("2026-01-02T08:00:00Z"));
  const prompts = await rows<{ to: string; subject: string; text: string }>(
    "select \"to\", subject, text from outbox where kind = 'prompt' order by \"to\"",
  );
  // The three contributors, not the reader, each asked the one thing the round holds.
  expect(prompts.map((row) => row.to)).toEqual(["alice@friendloop.test", "bob@friendloop.test", "owner@friendloop.test"]);
  for (const prompt of prompts) {
    expect(prompt.subject).toContain("1 question for Friday Loop");
    expect(prompt.text).toContain("- 📸 Photo wall");
  }
});
