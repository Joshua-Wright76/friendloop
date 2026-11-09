import { readFile } from "node:fs/promises";
import { test, expect, type Download, type Page } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { seedDeliveredIssue, seedLoop } from "../support/seed";
import { DELIVERY_DAY, openPart, signIn } from "../support/harness";
import { copy, text as copyText } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

async function downloaded(page: Page, click: () => Promise<void>): Promise<{ file: Download; json: Record<string, unknown> }> {
  const [file] = await Promise.all([page.waitForEvent("download"), click()]);
  const json = JSON.parse(await readFile((await file.path())!, "utf8"));
  return { file, json };
}

test("V4 · a person downloads their own words, and the owner downloads the whole loop", async ({ page, browser }) => {
  const loop = await seedLoop();
  await seedDeliveredIssue(loop, {
    deliveredAt: DELIVERY_DAY,
    answers: [
      { email: "owner@friendloop.test", body: "Sam's answer" },
      { email: "alice@friendloop.test", body: "Alice's answer" },
    ],
  });
  await signIn(page, "owner@friendloop.test");

  const mine = await downloaded(page, () => page.getByRole("link", { name: copy.you.download }).click());
  expect(mine.file.suggestedFilename()).toMatch(/^friendloop-my-data-\d{4}-\d{2}-\d{2}\.json$/);
  const personal = JSON.stringify(mine.json);
  expect(personal).toContain("Sam's answer");
  expect(personal).not.toContain("Alice's answer");

  await page.goto(`/g/${loop.groupId}/settings`);
  await openPart(page, copy.settings.groupKeep);
  const archive = await downloaded(page, () => page.getByRole("link", { name: copy.settings.archive }).click());
  expect(archive.file.suggestedFilename()).toMatch(/^friendloop-friday-loop-\d{4}-\d{2}-\d{2}\.json$/);
  const whole = JSON.stringify(archive.json);
  expect(whole).toContain("Sam's answer");
  expect(whole).toContain("Alice's answer");
  expect((archive.json.rounds as unknown[]).length).toBe(1);

  // Nobody else can fetch the archive: not a member, not a signed-out stranger.
  const alice = loop.members.find((member) => member.email === "alice@friendloop.test")!;
  const other = await browser.newPage();
  await signIn(other, alice.email);
  expect((await other.request.get(`/g/${loop.groupId}/export`)).status()).toBe(404);
  await other.close();
  const stranger = await browser.newContext();
  expect((await stranger.request.get(`/g/${loop.groupId}/export`)).status()).toBe(404);
  const signedOut = await stranger.request.get("/you/export", { maxRedirects: 0 });
  expect(signedOut.status()).toBe(303);
  await stranger.close();
});

test("V4 · a reply link downloads what its person wrote, from the leave page", async ({ page }) => {
  const loop = await seedLoop();
  await seedDeliveredIssue(loop, {
    deliveredAt: DELIVERY_DAY,
    answers: [
      { email: "alice@friendloop.test", body: "Alice's answer" },
      { email: "bob@friendloop.test", body: "Bob's answer" },
    ],
  });
  const alice = loop.members.find((member) => member.email === "alice@friendloop.test")!;

  await page.goto(`/r/${alice.token}/leave`);
  const mine = await downloaded(page, () => page.getByRole("link", { name: copy.leave.download }).click());
  const text = JSON.stringify(mine.json);
  expect(text).toContain("Alice's answer");
  expect(text).not.toContain("Bob's answer");
  expect((await page.request.get("/r/not-a-token/export")).status()).toBe(404);
});
