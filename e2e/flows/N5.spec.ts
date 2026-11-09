import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { signIn, unfold } from "../support/harness";
import { chooseFile, seedWorld } from "../support/identity";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { TINY_PNG } from "../support/comments";
import { copy, text as copyText, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

const photoOf = async (email: string, groupId: string) =>
  (await rows<{ photo_url: string | null }>("select photo_url from memberships where email = $1 and group_id = $2", [email, groupId]))[0].photo_url;

test("N5 · a contributor sets a photo on their reply sheet and it follows their answers and comments; removing it brings the initial back", async ({ page }) => {
  const { loop, delivered, alice } = await seedWorld();
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await rows("insert into comments (issue_id, membership_id, body) values ($1, $2, 'Honk.')", [delivered.issueId, alice.id]);
  await rows("insert into comments (issue_id, membership_id, body) values ($1, $2, 'Quack.')", [delivered.issueId, bob.id]);

  await page.goto(`/r/${alice.token}`);
  // Who is answering sits folded into one line, with the photo inside.
  await unfold(page, copyPattern(copy.reply.answeringAs));
  await expect(page.getByText(copy.identity.profile.hint)).toBeVisible();
  await chooseFile(page, "Choose a photo of yourself", { name: "me.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.getByText(copy.identity.profile.saved)).toBeVisible();
  const url = await photoOf("alice@friendloop.test", loop.groupId);
  expect(url).toMatch(/\/uploads\/[a-f0-9]{64}\.png$/);
  // The frame choices below show the same picture, so this is the first of several.
  await expect(page.locator(`.avatar img[src="${url}"]`).first()).toBeVisible();

  // Reload: the sheet remembers it.
  await page.reload();
  await expect(page.locator(`.avatar img[src="${url}"]`).first()).toBeVisible();

  // The delivered issue: the answer and the comment both carry it.
  await page.goto(`/i/${delivered.issueId}?m=${alice.token}`);
  await expect(page.locator(`.avatar img[src="${url}"]`)).toHaveCount(2);
  // Bob has no photo, so his comment keeps his initial.
  await expect(page.locator(".avatar:not(:has(img))", { hasText: "B" }).first()).toBeVisible();

  await page.goto(`/r/${alice.token}`);
  await unfold(page, copyPattern(copy.reply.answeringAs));
  await page.getByRole("button", { name: copy.issue.removePhoto }).click();
  await expect(page.getByText(copy.identity.profile.removed)).toBeVisible();
  expect(await photoOf("alice@friendloop.test", loop.groupId)).toBeNull();
  await page.goto(`/i/${delivered.issueId}?m=${alice.token}`);
  await expect(page.locator(".avatar img")).toHaveCount(0);
});

test("N5 · an invitee can set a photo straight from the link, while the loop is paused and as a reader", async ({ page }) => {
  // A paused loop takes no answers, so the invitation lands on the quiet page.
  const loop = await seedLoop();
  await rows("update groups set paused_at = now() where id = $1", [loop.groupId]);
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  await expect(page.getByRole("heading", { name: copy.reply.pausedTitle })).toBeVisible();
  await chooseFile(page, "Choose a photo of yourself", { name: "me.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.getByText(copy.identity.profile.saved)).toBeVisible();
  const url = await photoOf("alice@friendloop.test", loop.groupId);
  expect(url).toMatch(/\/uploads\/[a-f0-9]{64}\.png$/);
  await page.reload();
  await expect(page.locator(`.avatar img[src="${url}"]`).first()).toBeVisible();

  // A reader's invitation lands on the reader page, with the same control.
  await rows("update memberships set participation = 'reader', photo_url = null where id = $1", [alice.id]);
  await page.goto(`/r/${alice.token}`);
  await expect(page.getByRole("heading", { name: /You're a reader/ })).toBeVisible();
  await chooseFile(page, "Choose a photo of yourself", { name: "me.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.getByText(copy.identity.profile.saved)).toBeVisible();
  expect(await photoOf("alice@friendloop.test", loop.groupId)).toMatch(/\/uploads\//);
});

test("N5 · a signed-in member sets their own photo on the people page, and nobody else's", async ({ page }) => {
  const { loop } = await seedWorld();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/members`);

  // One control, on the viewer's own card.
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  const mine = page.locator(".card").filter({ hasText: "owner@friendloop.test" });
  await chooseFile(page, "Choose a photo of yourself", { name: "me.png", mimeType: "image/png", buffer: TINY_PNG }, mine);
  await expect(mine.getByText(copy.identity.profile.saved)).toBeVisible();
  const url = await photoOf("owner@friendloop.test", loop.groupId);
  // The controls sit under the person's own row, whose avatar is the one picture.
  await expect(page.locator(`.avatar img[src="${url}"]`)).toHaveCount(1);
  expect(await photoOf("alice@friendloop.test", loop.groupId)).toBeNull();

  // Bytes that are not a picture (a real oversize photo is shrunk: see T1).
  await chooseFile(page, "Choose a photo of yourself", { name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(2 * 1024 * 1024 + 1) }, mine);
  await expect(mine.getByText(copy.identity.errors.unreadable)).toBeVisible();
  expect(await photoOf("owner@friendloop.test", loop.groupId)).toBe(url);
});

test("N5 · the photo routes answer only the person they belong to", async ({ request }) => {
  const { loop, alice } = await seedWorld();
  const form = { multipart: { photo: { name: "x.png", mimeType: "image/png", buffer: TINY_PNG } } };

  expect((await request.post("/api/reply/not-a-real-token/profile-photo", form)).status()).toBe(403);
  expect((await request.delete("/api/reply/not-a-real-token/profile-photo")).status()).toBe(403);
  expect((await request.post(`/api/loop/${loop.groupId}/profile-photo`, form)).status()).toBe(403);
  expect((await request.delete(`/api/loop/${loop.groupId}/profile-photo`)).status()).toBe(403);

  // A reader's link opens no sheet, but the photo is still theirs: it rides on their comments.
  await rows("update memberships set participation = 'reader' where id = $1", [alice.id]);
  expect((await request.post(`/api/reply/${alice.token}/profile-photo`, form)).status()).toBe(200);
  await rows("update memberships set photo_url = null where id = $1", [alice.id]);
  expect((await request.delete(`/api/reply/${alice.token}/profile-photo`)).status()).toBe(200);
  // A removed member's link sets nothing.
  await rows("update memberships set revoked_at = now() where id = $1", [alice.id]);
  expect((await request.post(`/api/reply/${alice.token}/profile-photo`, form)).status()).toBe(403);
  await rows("update memberships set revoked_at = null where id = $1", [alice.id]);

  // A real contributor with no file, or a file that is not an image, is told so plainly.
  await rows("update memberships set participation = 'contributor' where id = $1", [alice.id]);
  const none = await request.post(`/api/reply/${alice.token}/profile-photo`, { multipart: { other: "x" } });
  expect(none.status()).toBe(400);
  const text = await request.post(`/api/reply/${alice.token}/profile-photo`, {
    multipart: { photo: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("hello") } },
  });
  expect(text.status()).toBe(415);
  expect(await photoOf("alice@friendloop.test", loop.groupId)).toBeNull();
});

test("N5 · someone added by email alone is greeted without their email handle and asked for a name first", async ({ page }) => {
  const loop = await seedLoop({ members: [{ email: "dabluj76@friendloop.test" }] });
  await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  const newcomer = loop.members.find((member) => member.email.startsWith("dabluj76"))!;

  await page.goto(`/r/${newcomer.token}`);
  await expect(page.getByText(copy.reply.hiThere)).toBeVisible();
  await expect(page.getByText("dabluj76")).toHaveCount(0);
  // The name field is already open: no need to find "Edit name and photo".
  const field = page.getByLabel(copy.reply.nameTitle);
  await expect(field).toBeVisible();
  await field.fill("Dana");
  await field.blur();
  await expect.poll(async () =>
    (await rows<{ name: string | null }>("select name from memberships where id = $1", [newcomer.id]))[0].name,
  ).toBe("Dana");
  await expect(page.getByText("Hi Dana,")).toBeVisible();

  // Next time, with a name on file, the line folds away as usual.
  await page.reload();
  await expect(page.getByText(copyText(copy.reply.answeringAs, { name: "Dana" }))).toBeVisible();
  await expect(page.getByLabel(copy.reply.nameTitle)).toBeHidden();
});
