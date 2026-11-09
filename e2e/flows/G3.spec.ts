import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { addMember, seedLoop } from "../support/seed";
import { signIn } from "../support/harness";
import { copy, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("G3 · an admin manages people and settings, while downloading and deleting the loop stay the owner's", async ({ page }) => {
  const loop = await seedLoop();
  const member = await addMember(loop, { email: "admin@friendloop.test", access: "member" });
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/members`);
  const card = page.locator(".card").filter({ hasText: "admin@friendloop.test" });
  await card.getByRole("button", { name: /Role for/ }).click();
  await card.getByRole("option", { name: copy.common.roles.admin, exact: true }).click();
  await expect(card.getByRole("button", { name: /Role for.*Admin/ })).toBeVisible();

  // The menu shows the choice as soon as it's made, so wait for the write behind it.
  await expect.poll(async () => {
    const [row] = await rows<{ access: string }>("select access from memberships where id = $1", [member.id]);
    return row.access;
  }).toBe("admin");

  await page.context().clearCookies();
  await signIn(page, "admin@friendloop.test");

  await page.goto(`/g/${loop.groupId}/members`);
  await expect(page.getByLabel(copy.members.inviteAriaLabel)).toBeVisible();

  await page.goto(`/g/${loop.groupId}/questions`);
  await expect(page.getByLabel(copyPattern(copy.questions.item.textLabel, { start: true }))).toBeVisible();

  // Settings are theirs to change too, and the nav says where.
  await expect(page.getByRole("navigation", { name: copy.common.navigation.ariaLabel }).getByRole("link", { name: copy.common.navigation.settings })).toBeVisible();
  await page.goto(`/g/${loop.groupId}/settings`);
  await expect(page.getByText(copy.settings.adminNote)).toBeVisible();
  await page.locator('input[name="name"]').fill("Admin's Loop");
  await page.getByRole("button", { name: copy.settings.save }).click();
  await expect(page.getByText(copy.settings.savedNotice)).toBeVisible();
  const [group] = await rows<{ name: string }>("select name from groups where id = $1", [loop.groupId]);
  expect(group.name).toBe("Admin's Loop");

  // Downloading everything and deleting it are not offered, and not served.
  await page.getByRole("button", { name: copy.settings.groupKeep }).click();
  await expect(page.getByRole("link", { name: copy.settings.archive })).toHaveCount(0);
  await expect(page.getByRole("button", { name: copy.settings.groupDanger })).toHaveCount(0);
  await expect(page.getByText(copy.settings.deleteTitle)).toHaveCount(0);
  expect((await page.request.get(`/g/${loop.groupId}/export`)).status()).toBe(404);
});

test("G3 · a plain member never reaches settings", async ({ page }) => {
  const loop = await seedLoop();
  await addMember(loop, { email: "member@friendloop.test", access: "member" });
  await signIn(page, "member@friendloop.test");

  await page.goto(`/g/${loop.groupId}/members`);
  await expect(page.getByRole("navigation", { name: copy.common.navigation.ariaLabel }).getByRole("link", { name: copy.common.navigation.settings })).toHaveCount(0);
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
  const promoted = await addMember(loop, { email: "promoted@friendloop.test", access: "member" });

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
    await expect(memberPage.getByLabel(copy.members.inviteAriaLabel)).toHaveCount(0);

    await ownerPage.goto(`/g/${loop.groupId}/members`);
    const card = ownerPage.locator(".card").filter({ hasText: "promoted@friendloop.test" });
    await card.getByRole("button", { name: /Role for/ }).click();
    await card.getByRole("option", { name: copy.common.roles.admin, exact: true }).click();
    await expect(card.getByRole("button", { name: /Role for.*Admin/ })).toBeVisible();
    // The menu shows the choice as soon as it's made, so wait for the write behind it.
    await expect.poll(async () => {
      const [row] = await rows<{ access: string }>("select access from memberships where id = $1", [promoted.id]);
      return row.access;
    }).toBe("admin");

    // Same browser session, same cookies, no sign-in in between.
    await memberPage.goto(`/g/${loop.groupId}/members`);
    await expect(memberPage.getByLabel(copy.members.inviteAriaLabel)).toBeVisible();
  } finally {
    await ownerContext.close();
    await memberContext.close();
  }
});
