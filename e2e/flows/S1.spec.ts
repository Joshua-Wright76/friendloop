import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { signIn } from "../support/harness";
import { AFTER_FIRST_SLOT } from "../support/clock";
import { copy } from "@/lib/copy";

const SECRET = process.env.UI_PREVIEW_SECRET ?? "e2e-preview-secret";

test.beforeEach(async () => {
  await resetDatabase();
});

type Note = {
  message: string;
  path: string;
  sender_name: string | null;
  sender_email: string | null;
  membership_id: string | null;
  user_id: string | null;
  viewport: string | null;
  user_agent: string | null;
};
const notes = () =>
  rows<Note>("select message, path, sender_name, sender_email, membership_id, user_id, viewport, user_agent from feedback order by created_at");

test("S1 · anyone sends a note from the corner button with one box and one tap", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: copy.feedback.open }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: copy.feedback.title })).toBeVisible();
  const send = dialog.getByRole("button", { name: copy.feedback.send });
  await expect(send).toBeDisabled();

  await dialog.getByLabel(copy.feedback.label).fill("The home page logo looks squashed");
  await send.click();
  await expect(dialog.getByText(copy.feedback.thanks)).toBeVisible();

  // A stranger is not asked who they are, and is not guessed at either; the page and screen size come along.
  const [note] = await notes();
  expect(note.message).toBe("The home page logo looks squashed");
  expect(note.path).toBe("/");
  expect(note.viewport).toMatch(/^\d+×\d+$/);
  expect(note.user_agent).toBeTruthy();
  expect(`${note.user_id}/${note.membership_id}/${note.sender_email}`).toBe("null/null/null");

  // Done closes it; the box is empty the next time.
  await dialog.getByRole("button", { name: copy.feedback.done }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: copy.feedback.open }).click();
  await expect(page.getByLabel(copy.feedback.label)).toHaveValue("");
});

test("S1 · an unsent note survives cancelling, and a blank one cannot be sent", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: copy.feedback.open }).click();
  await page.getByLabel(copy.feedback.label).fill("   ");
  await expect(page.getByRole("button", { name: copy.feedback.send, exact: true })).toBeDisabled();

  await page.getByLabel(copy.feedback.label).fill("Half a thought");
  await page.getByRole("button", { name: copy.feedback.cancel }).click();
  await page.getByRole("button", { name: copy.feedback.open }).click();
  await expect(page.getByLabel(copy.feedback.label)).toHaveValue("Half a thought");
  expect(await notes()).toHaveLength(0);
});

test("S1 · a failed send keeps the words and says so", async ({ page }) => {
  await page.route("**/api/feedback", (route) => route.abort());
  await page.goto("/");
  await page.getByRole("button", { name: copy.feedback.open }).click();
  await page.getByLabel(copy.feedback.label).fill("Please keep this");
  await page.getByRole("button", { name: copy.feedback.send, exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(copy.feedback.errors.network);
  await expect(page.getByLabel(copy.feedback.label)).toHaveValue("Please keep this");
});

test("S1 · a signed-in owner and a contributor on their link are named, and the link never lands in the note", async ({ page }) => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/r/${alice.token}`);
  await page.getByRole("button", { name: copy.feedback.open }).click();
  await page.getByLabel(copy.feedback.label).fill("The reply box jumps when I type");
  await page.getByRole("button", { name: copy.feedback.send, exact: true }).click();
  await expect(page.getByText(copy.feedback.thanks)).toBeVisible();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/members`);
  await page.getByRole("button", { name: copy.feedback.open }).click();
  await page.getByLabel(copy.feedback.label).fill("Wish I could reorder members");
  await page.getByRole("button", { name: copy.feedback.send, exact: true }).click();
  await expect(page.getByText(copy.feedback.thanks)).toBeVisible();

  const [fromLink, fromSession] = await notes();
  expect(fromLink.sender_email).toBe("alice@friendloop.test");
  expect(fromLink.membership_id).not.toBeNull();
  expect(fromLink.path).toBe("/r/…");
  expect(JSON.stringify(fromLink)).not.toContain(alice.token);
  expect(fromSession.sender_email).toBe("owner@friendloop.test");
  expect(fromSession.path).toBe(`/g/${loop.groupId}/members`);
});

test("S1 · the button sits clear of the reply bar and the theme switch", async ({ page }) => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  await page.goto(`/r/${alice.token}`);

  const feedback = await page.getByRole("button", { name: copy.feedback.open }).boundingBox();
  const theme = await page.locator(".theme-switch").boundingBox();
  const bar = await page.locator(".reply-actionbar").boundingBox();
  expect(feedback!.y + feedback!.height).toBeLessThanOrEqual(bar!.y);
  expect(feedback!.x + feedback!.width).toBeLessThanOrEqual(theme!.x);
});

test("S1 · notes are read in the key-locked inbox", async ({ page }) => {
  await rows("insert into feedback (message, path, viewport) values ('It broke', '/you', '390×844')");

  const locked = await page.goto("/dev/feedback");
  expect(locked?.status()).toBe(404);

  await page.goto(`/dev/ui?key=${SECRET}`);
  await page.goto("/dev/feedback");
  await expect(page.getByRole("heading", { name: copy.devFeedback.title })).toBeVisible();
  await expect(page.getByText("It broke")).toBeVisible();
  await expect(page.getByText(copy.devFeedback.anonymous)).toBeVisible();
});
