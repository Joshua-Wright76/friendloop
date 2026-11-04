import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { resetDatabase, rows } from "./support/db";
import { addMember, seedDeliveredIssue, seedLoop, seedOpenIssue } from "./support/seed";
import { seedPoll, seedPollVote } from "./support/polls";
import { signIn } from "./support/harness";
import { seedAlbum } from "./support/album";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// Entrance animations start at opacity 0, and axe blends the colors it reads
// mid-fade into false contrast failures. Reduced motion ends them immediately,
// so the audit measures the page a reader actually keeps looking at.
test.use({ reducedMotion: "reduce" });

async function audit(page: Page, path: string, navigate = true) {
  if (navigate) await page.goto(path);
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    result.violations,
    `${path}: ${result.violations.map((violation) => `${violation.id} (${violation.nodes.length})`).join(", ")}`,
  ).toEqual([]);
}

async function auditThemes(page: Page, paths: string[]) {
  for (const theme of ["light", "dark"] as const) {
    for (const path of paths) {
      await page.goto(path);
      if (await page.locator("html").getAttribute("data-theme") !== theme) {
        await page.getByRole("button", { name: theme === "light" ? /switch to light mode/ : /switch to dark mode/ }).click();
      }
      await audit(page, path);
    }
  }
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("WCAG AA · public and authentication pages", async ({ page }) => {
  test.setTimeout(90_000);
  await auditThemes(page, ["/", "/signin", "/signin/check-email", "/signin/confirm?problem=unknown", "/r/invalid"]);
});

test("WCAG AA · loop management, creation, and reply pages", async ({ page }) => {
  test.setTimeout(120_000);
  const loop = await seedLoop();
  // Polls on the pool list and the reply sheet, single and multiple choice.
  await seedPoll(loop, { text: "Where should we camp?", options: ["The lake", "The mountains", "The coast"] });
  await seedPoll(loop, { text: "Which weekends work?", options: ["June", "July", "August"], multiple: true });
  await seedOpenIssue(loop, { openedAt: new Date("2026-10-23T07:00:00Z") });
  await signIn(page, "owner@friendloop.test");

  await auditThemes(page, [
    "/you",
    "/g/new",
    `/g/${loop.groupId}`,
    `/g/${loop.groupId}/members`,
    `/g/${loop.groupId}/questions`,
    `/g/${loop.groupId}/issues`,
    `/g/${loop.groupId}/settings`,
    `/r/${loop.ownerToken}`,
  ]);

  await page.goto("/g/new");
  await page.getByRole("button", { name: /^Timezone:/ }).click();
  await audit(page, "/g/new?picker=open", false);

  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Timezone:/ }).click();
  const pickerSheet = page.getByRole("dialog", { name: "Timezone" });
  await expect(pickerSheet).toBeVisible();
  await audit(page, "/g/new?picker=phone", false);
  const timezoneTrigger = page.getByRole("button", { name: /^Timezone:/ });
  const closePicker = pickerSheet.getByRole("button", { name: "Close" });
  const activeOption = pickerSheet.locator('[role="option"][aria-selected="true"]');
  const searchBox = pickerSheet.getByRole("textbox", { name: "Search timezones…" });

  // The sheet contains keyboard focus in both directions, including when the
  // active option is the last focusable control.
  await expect(searchBox).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(closePicker).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(activeOption).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closePicker).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pickerSheet).toBeHidden();
  await expect(timezoneTrigger).toBeFocused();

  await timezoneTrigger.click();
  await expect(pickerSheet).toBeVisible();
  await closePicker.click();
  await expect(pickerSheet).toBeHidden();
  await expect(timezoneTrigger).toBeFocused();

  await timezoneTrigger.click();
  await expect(pickerSheet).toBeVisible();
  await searchBox.fill("Tokyo");
  await pickerSheet.getByRole("option", { name: "Asia/Tokyo" }).click();
  await expect(page.locator('input[name="timezone"]')).toHaveValue("Asia/Tokyo");
  await expect(page.getByRole("button", { name: "Timezone: Asia/Tokyo" })).toBeVisible();
  await expect(pickerSheet).toBeHidden();
  await expect(timezoneTrigger).toBeFocused();

  // Updating a member role must preserve the trigger node and keyboard focus.
  await page.goto(`/g/${loop.groupId}/members`);
  const roleTrigger = page.getByRole("button", { name: /^Member type for .+:/ }).first();
  await roleTrigger.click();
  await page.getByRole("option", { name: "Admin" }).first().click();
  await expect(roleTrigger).toBeFocused();
});

test("WCAG AA · stationery, handover, round names and profile photos", async ({ page }) => {
  test.setTimeout(120_000);
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: new Date("2026-10-23T07:00:00Z") });
  await addMember(loop, { email: "heir@friendloop.test", access: "admin" });
  await rows("update issues set name = 'Camping weekend' where group_id = $1", [loop.groupId]);
  await rows("update groups set theme_preset = 'bluebell', theme_accent = '#ffee00', header_image_url = '/uploads/' || repeat('a', 64) || '.png' where id = $1", [loop.groupId]);
  await signIn(page, "owner@friendloop.test");

  for (const theme of ["light", "dark"] as const) {
    await page.goto(`/g/${loop.groupId}/members`);
    if ((await page.locator("html").getAttribute("data-theme")) !== theme) {
      await page.getByRole("button", { name: theme === "light" ? /switch to light mode/ : /switch to dark mode/ }).click();
    }
    await page.getByRole("button", { name: "Make heir the owner" }).click();
    await expect(page.getByRole("group", { name: /Hand .* to heir/ })).toBeVisible();
    await audit(page, `members with the handover question open (${theme})`, false);

    await page.goto(`/g/${loop.groupId}/issues`);
    await page.getByText("Rename", { exact: true }).first().click();
    await audit(page, `rounds with the name form open (${theme})`, false);
  }
});

test("WCAG AA · a picker keeps focus across a save that disables it", async ({ page }) => {
  test.setTimeout(60_000);
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");

  // The browser blurs a control the instant it becomes disabled, and re-enabling
  // does not give focus back. On a fast local machine the server action resolves
  // before React commits that disabled state, so the bug stays invisible; CI's
  // slower round trip exposes it. Holding the action open makes the disable cycle
  // deterministic everywhere instead of timing-dependent.
  await page.route(`**/g/${loop.groupId}/members`, async (route) => {
    if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });

  await page.goto(`/g/${loop.groupId}/members`);
  const roleTrigger = page.getByRole("button", { name: /^Member type for .+:/ }).first();
  await roleTrigger.click();
  await page.getByRole("option", { name: "Admin" }).first().click();

  await expect(roleTrigger).toHaveAccessibleName(/Member type for .+: Admin/);
  await expect(roleTrigger).toBeEnabled();
  await expect(roleTrigger).toBeFocused();
});

test("WCAG AA · delivered and shared issues", async ({ page }) => {
  test.setTimeout(90_000);
  const loop = await seedLoop();
  await seedPoll(loop, { text: "Where should we camp?", options: ["The lake", "The mountains", "The coast"] });
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "The cat fist bump." }],
    shareToken: "a11y-share-token",
  });
  await seedPollVote(issue.issueId, loop.members.find((member) => member.email.startsWith("alice"))!.id, [0]);
  await seedPollVote(issue.issueId, loop.members.find((member) => member.email.startsWith("bob"))!.id, [2]);
  await db.update(groups).set({ shareEnabled: true }).where(eq(groups.id, loop.groupId));
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await auditThemes(page, [`/i/${issue.issueId}?m=${alice.token}`, "/s/a11y-share-token"]);
});

test("WCAG AA · comments: an open answer thread, the mention list, a quote, light and dark", async ({ page }) => {
  test.setTimeout(90_000);
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [
      { email: "alice@friendloop.test", body: "Alice found a very patient goose." },
      { email: "bob@friendloop.test", body: "Bob rebuilt the shed." },
    ],
  });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  const [reply] = await rows<{ id: string }>("select id from replies where membership_id = $1", [bob.id]);
  const [first] = await rows<{ id: string }>(
    "insert into comments (issue_id, membership_id, reply_id, body) values ($1, $2, $3, $4) returning id",
    [issue.issueId, alice.id, reply.id, `Great shed, @[${bob.id}]`],
  );
  await rows(
    "insert into comments (issue_id, membership_id, reply_id, body, quote_comment_id) values ($1, $2, $3, 'Thanks!', $4)",
    [issue.issueId, bob.id, reply.id, first.id],
  );

  for (const theme of ["light", "dark"] as const) {
    await page.goto(`/i/${issue.issueId}?m=${alice.token}`);
    if (await page.locator("html").getAttribute("data-theme") !== theme) {
      await page.getByRole("button", { name: theme === "light" ? /switch to light mode/ : /switch to dark mode/ }).click();
    }
    const answer = page.locator("article").filter({ hasText: "Bob rebuilt the shed." });
    await answer.getByRole("button", { name: "2 comments" }).click();
    await answer.getByRole("button", { name: "Reply to Bob" }).click();
    const box = answer.getByLabel("Comment on Bob's answer");
    await box.pressSequentially("hello @");
    await expect(page.getByRole("listbox", { name: "People to mention" })).toBeVisible();
    await audit(page, "comments", false);
  }
});

test("WCAG AA · events and birthdays: the calendar with an event open for editing, light and dark", async ({ page }) => {
  test.setTimeout(120_000);
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await rows("insert into events (group_id, kind, emoji, month, day, membership_id) values ($1, 'birthday', '🎂', 3, 14, $2)", [loop.groupId, alice.id]);
  await rows("insert into events (group_id, kind, title, emoji, month, day, year) values ($1, 'once', 'The housewarming', '🏡', 6, 20, 2099)", [loop.groupId]);
  await signIn(page, "owner@friendloop.test");

  for (const theme of ["light", "dark"] as const) {
    await page.goto(`/g/${loop.groupId}/questions`);
    if ((await page.locator("html").getAttribute("data-theme")) !== theme) {
      await page.getByRole("button", { name: theme === "light" ? /switch to light mode/ : /switch to dark mode/ }).click();
    }
    const panel = page.getByRole("region", { name: "Events and birthdays" });
    await panel.getByText("Edit").first().click();
    await panel.getByLabel("Type of event").selectOption({ label: "One-time event" });
    await audit(page, `the calendar with an edit form and the one-time form open (${theme})`, false);
  }
});

test("WCAG AA · the Album: gallery, empty result, inbox link and the open viewer, light and dark", async ({ page }) => {
  test.setTimeout(120_000);
  const world = await seedAlbum();
  await signIn(page, "owner@friendloop.test");

  await auditThemes(page, [
    `/g/${world.loop.groupId}/album`,
    `/g/${world.loop.groupId}/album?q=zebra`,
    `/album/${world.loop.groupId}?m=${world.alice.token}`,
  ]);

  for (const theme of ["light", "dark"] as const) {
    await page.goto(`/g/${world.loop.groupId}/album`);
    if ((await page.locator("html").getAttribute("data-theme")) !== theme) {
      await page.getByRole("button", { name: theme === "light" ? /switch to light mode/ : /switch to dark mode/ }).click();
    }
    await page.getByRole("button", { name: /^Open photo from Bob/ }).click();
    await expect(page.getByRole("dialog", { name: "Photo viewer" })).toBeVisible();
    await audit(page, `album viewer open (${theme})`, false);
    await page.keyboard.press("Escape");
  }
});
