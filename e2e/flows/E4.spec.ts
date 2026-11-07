import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedDeliveredIssue, seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

// The button changes as soon as it's pressed, so wait for the write behind it.
async function reactionCount(): Promise<number> {
  const [row] = await rows<{ count: number }>("select count(*)::int as count from reactions");
  return row.count;
}

test("E4 · reacting toggles on and off", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "Something worth a heart." }],
  });
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  await page.goto(`/i/${issue.issueId}?m=${bob.token}`);
  const heart = page.getByRole("button", { name: /React with ❤️/ }).first();
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");

  await expect.poll(reactionCount).toBe(1);

  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "false");
  await expect.poll(reactionCount).toBe(0);
});

test("E4 · a reaction reaches the person whose answer it is", async ({ browser }) => {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "Something worth a heart." }],
  });

  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  try {
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();
    await signIn(alicePage, "alice@friendloop.test");
    await signIn(bobPage, "bob@friendloop.test");

    await alicePage.goto(`/i/${issue.issueId}`);
    const aliceHeart = alicePage.getByRole("button", { name: /React with ❤️/ }).first();
    await expect(aliceHeart).toHaveAttribute("aria-pressed", "false");

    await bobPage.goto(`/i/${issue.issueId}`);
    await bobPage.getByRole("button", { name: /React with ❤️/ }).first().click();
    await expect.poll(reactionCount).toBe(1);

    await alicePage.reload();
    const after = alicePage.getByRole("button", { name: /React with ❤️/ }).first();
    await expect(after).toContainText("1");
    await expect(after, "the count is not the viewer's own reaction").toHaveAttribute(
      "aria-pressed",
      "false",
    );
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test("E4 · any emoji can be found and added, with nobody's approval, and shows for everyone", async ({ browser, page }) => {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "Something worth a frog." }],
  });
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/i/${issue.issueId}?m=${bob.token}`);
  const add = page.getByRole("button", { name: "Add a reaction to Alice's answer" });
  await add.click();
  const picker = page.getByRole("dialog", { name: "Add a reaction to Alice's answer" });
  await expect(picker).toBeVisible();

  // Search by name, and by a word that isn't in the name.
  await picker.getByRole("searchbox", { name: "Search for an emoji" }).fill("zzzzzz");
  await expect(picker.getByRole("status")).toHaveText("No emoji by that name. Try another word.");
  await picker.getByRole("searchbox", { name: "Search for an emoji" }).fill("frog");
  await picker.getByRole("button", { name: "frog", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(add, "focus goes back where it came from").toBeFocused();

  const frog = page.getByRole("button", { name: /React with 🐸/ });
  await expect(frog).toHaveAttribute("aria-pressed", "true");
  await expect.poll(reactionCount).toBe(1);

  // Picking it again from the sheet keeps it; its chip takes it back.
  await add.click();
  await picker.getByRole("searchbox", { name: "Search for an emoji" }).fill("frog");
  await page.keyboard.press("Enter");
  await expect(picker).toBeHidden();
  await expect.poll(reactionCount).toBe(1);

  // Arrow keys walk the grid, and Escape closes without choosing.
  await add.click();
  await expect(picker.locator("button[data-emoji]").first()).toBeVisible();
  await picker.locator("button[data-emoji]").first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(picker.locator("button[data-emoji]").nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect.poll(reactionCount).toBe(1);

  // The person it's for sees it, on a chip of its own.
  const context = await browser.newContext();
  const alicePage = await context.newPage();
  await alicePage.goto(`/i/${issue.issueId}?m=${alice.token}`);
  const seen = alicePage.getByRole("button", { name: /React with 🐸/ });
  await expect(seen).toHaveAttribute("aria-pressed", "false");
  await expect(seen).toHaveAccessibleName(/, 1$/);
  await context.close();

  await frog.click();
  await expect.poll(reactionCount).toBe(0);
});
