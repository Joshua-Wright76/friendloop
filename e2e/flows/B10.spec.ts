import { test, expect } from "@playwright/test";
import { latestOutbox, resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

const tokenIn = (html: string) => decodeURIComponent(/token=([A-Za-z0-9_%-]+)/.exec(html)![1]);

test("B10 · the owner copies the loop's link, and a friend joins with just their email", async ({ page, browser }) => {
  const loop = await seedLoop({ members: [] });
  await signIn(page, "owner@friendloop.test");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto(`/g/${loop.groupId}/members`);
  const field = page.getByRole("textbox", { name: "Invite link" });
  const link = await field.inputValue();
  expect(link).toMatch(/\/join\/[A-Za-z0-9_-]{20,}$/);
  await page.getByRole("button", { name: "Copy invite link" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  // The friend, on their own phone, with no account.
  const friendContext = await browser.newContext();
  const friend = await friendContext.newPage();
  await friend.goto(new URL(link).pathname);
  await expect(friend.getByRole("heading", { name: "Join Friday Loop" })).toBeVisible();
  await expect(friend.getByText(/Sam invited you to Friday Loop/)).toBeVisible();

  await friend.getByRole("textbox", { name: /Your email/ }).fill("Nia@friendloop.test");
  await friend.getByRole("button", { name: "Join the loop" }).click();
  await expect(friend).toHaveURL(/\/signin\/check-email$/);
  expect(await rows("select 1 from memberships where email = 'nia@friendloop.test'"), "nothing joins before the address is confirmed").toHaveLength(0);

  const mail = await latestOutbox("signin:");
  expect(mail.subject).toMatch(/^Join Friday Loop: \d{6}$/);
  await friend.goto(`/signin/confirm?token=${encodeURIComponent(tokenIn(mail.html))}`);
  await friend.getByLabel("Your name").fill("Nia");
  await friend.getByRole("button", { name: "Sign in" }).click();

  await expect(friend).toHaveURL(new RegExp(`/g/${loop.groupId}\\?welcome=joined$`));
  await expect(friend.getByText("You're in. Answer whenever you like", { exact: false })).toBeVisible();
  const [member] = await rows<{ name: string; access: string; participation: string; accepted_at: Date | null }>(
    "select name, access, participation, accepted_at from memberships where email = 'nia@friendloop.test'",
  );
  expect(member).toMatchObject({ name: "Nia", access: "member", participation: "contributor" });
  expect(member.accepted_at).not.toBeNull();

  // Members don't hand the link around; only those who run the loop see it.
  await friend.goto(`/g/${loop.groupId}/members`);
  await expect(friend.getByRole("heading", { name: "People" })).toBeVisible();
  await expect(friend.getByRole("textbox", { name: "Invite link" })).toHaveCount(0);

  // Opening the link again just goes into the loop.
  await friend.goto(new URL(link).pathname);
  await expect(friend).toHaveURL(new RegExp(`/g/${loop.groupId}$`));
  await friendContext.close();
});

test("B10 · someone already signed in joins in one tap", async ({ page, browser }) => {
  const loop = await seedLoop({ members: [] });
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/members`);
  const path = new URL(await page.getByRole("textbox", { name: "Invite link" }).inputValue()).pathname;

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signIn(other, "returning@friendloop.test");
  await other.goto(path);
  await expect(other.getByText("returning@friendloop.test")).toBeVisible();
  await other.getByRole("button", { name: "Join Friday Loop" }).click();
  await expect(other).toHaveURL(new RegExp(`/g/${loop.groupId}\\?welcome=joined$`));
  expect(await rows("select 1 from memberships where email = 'returning@friendloop.test' and revoked_at is null")).toHaveLength(1);
  await otherContext.close();
});

test("B10 · resetting the link turns the old one off, and a removed person can't use it to come back", async ({ page, browser }) => {
  const loop = await seedLoop({ members: [{ email: "gone@friendloop.test", name: "Gone" }] });
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/members`);
  const field = page.getByRole("textbox", { name: "Invite link" });
  const oldPath = new URL(await field.inputValue()).pathname;

  // A removed person, signed in, opening the link.
  await rows("update memberships set revoked_at = now() where email = 'gone@friendloop.test'");
  const goneContext = await browser.newContext();
  const gone = await goneContext.newPage();
  await signIn(gone, "gone@friendloop.test");
  await gone.goto(oldPath);
  await expect(gone.getByRole("heading", { name: "You're not in Friday Loop anymore" })).toBeVisible();
  await expect(gone.getByRole("button", { name: /Join/ })).toHaveCount(0);
  await goneContext.close();

  await page.getByRole("button", { name: "Reset link" }).click();
  await page.getByRole("button", { name: "Make a new link" }).click();
  await expect(page.getByText("There's a new invite link. The old one doesn't work anymore.")).toBeVisible();
  await expect(field).not.toHaveValue(new RegExp(`${oldPath}$`));

  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  await stranger.goto(oldPath);
  await expect(stranger.getByRole("heading", { name: "This invite link doesn't work anymore" })).toBeVisible();
  await expect(stranger.getByRole("textbox", { name: /Your email/ })).toHaveCount(0);
  await strangerContext.close();
});
