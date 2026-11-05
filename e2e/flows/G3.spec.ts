import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { addMember, seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("G3 · an admin manages people but never reaches owner settings", async ({ page }) => {
  const loop = await seedLoop();
  const member = await addMember(loop, { email: "admin@friendloop.test", access: "member" });
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/members`);
  const card = page.locator(".card").filter({ hasText: "admin@friendloop.test" });
  await card.getByRole("button", { name: /Member type for/ }).click();
  await card.getByRole("option", { name: "Admin", exact: true }).click();
  await expect(card.getByRole("button", { name: /Member type for.*Admin/ })).toBeVisible();

  // The menu shows the choice as soon as it's made, so wait for the write behind it.
  await expect.poll(async () => {
    const [row] = await rows<{ access: string }>("select access from memberships where id = $1", [member.id]);
    return row.access;
  }).toBe("admin");

  await page.context().clearCookies();
  await signIn(page, "admin@friendloop.test");

  await page.goto(`/g/${loop.groupId}/members`);
  await expect(page.getByLabel("Invite people by email")).toBeVisible();

  await page.goto(`/g/${loop.groupId}/questions`);
  await expect(page.getByLabel("New question")).toBeVisible();

  await page.goto(`/g/${loop.groupId}/settings`);
  await expect(page).toHaveURL(new RegExp(`/g/${loop.groupId}$`));
});

/**
 * The promotion above happens *while* the other person is already signed in and
 * looking at the loop. That is the case a shared cache gets wrong: the owner's
 * request invalidates, the admin's next request must observe it, not a page
 * rendered before the change.
 */
test("G3 · a promotion reaches the other person's live session", async ({ browser }) => {
  const loop = await seedLoop();
  await addMember(loop, { email: "promoted@friendloop.test", access: "member" });

  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  try {
    const ownerPage = await ownerContext.newPage();
    const memberPage = await memberContext.newPage();

    await signIn(ownerPage, "owner@friendloop.test");
    await signIn(memberPage, "promoted@friendloop.test");

    // The member starts where a plain member starts: the members tab renders,
    // but without the invite form.
    await memberPage.goto(`/g/${loop.groupId}/members`);
    await expect(memberPage.getByLabel("Invite people by email")).toHaveCount(0);

    await ownerPage.goto(`/g/${loop.groupId}/members`);
    const card = ownerPage.locator(".card").filter({ hasText: "promoted@friendloop.test" });
    await card.getByRole("button", { name: /Member type for/ }).click();
    await card.getByRole("option", { name: "Admin", exact: true }).click();
    await expect(card.getByRole("button", { name: /Member type for.*Admin/ })).toBeVisible();

    // Same browser session, same cookies, no sign-in in between.
    await memberPage.goto(`/g/${loop.groupId}/members`);
    await expect(memberPage.getByLabel("Invite people by email")).toBeVisible();
  } finally {
    await ownerContext.close();
    await memberContext.close();
  }
});
