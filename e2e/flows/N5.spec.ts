import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { signIn } from "../support/harness";
import { chooseFile, seedWorld } from "../support/identity";
import { TINY_PNG } from "../support/comments";

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
  await expect(page.getByText("Shown next to your answers and comments in this loop, and nowhere else.")).toBeVisible();
  await chooseFile(page, "Choose a photo of yourself", { name: "me.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.getByText("Photo saved.")).toBeVisible();
  const url = await photoOf("alice@friendloop.test", loop.groupId);
  expect(url).toMatch(/\/uploads\/[a-f0-9]{64}\.png$/);
  await expect(page.locator(`.avatar img[src="${url}"]`)).toBeVisible();

  // Reload: the sheet remembers it.
  await page.reload();
  await expect(page.locator(`.avatar img[src="${url}"]`)).toBeVisible();

  // The delivered issue: the answer and the comment both carry it.
  await page.goto(`/i/${delivered.issueId}?m=${alice.token}`);
  await expect(page.locator(`.avatar img[src="${url}"]`)).toHaveCount(2);
  // Bob has no photo, so his comment keeps his initial.
  await expect(page.locator(".avatar:not(:has(img))", { hasText: "B" }).first()).toBeVisible();

  await page.goto(`/r/${alice.token}`);
  await page.getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByText("Photo removed.")).toBeVisible();
  expect(await photoOf("alice@friendloop.test", loop.groupId)).toBeNull();
  await page.goto(`/i/${delivered.issueId}?m=${alice.token}`);
  await expect(page.locator(".avatar img")).toHaveCount(0);
});

test("N5 · a signed-in member sets their own photo on the people page, and nobody else's", async ({ page }) => {
  const { loop } = await seedWorld();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/members`);

  // One control, on the viewer's own card.
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  const mine = page.locator(".card").filter({ hasText: "owner@friendloop.test" });
  await chooseFile(page, "Choose a photo of yourself", { name: "me.png", mimeType: "image/png", buffer: TINY_PNG }, mine);
  await expect(mine.getByText("Photo saved.")).toBeVisible();
  const url = await photoOf("owner@friendloop.test", loop.groupId);
  await expect(page.locator(`.avatar img[src="${url}"]`)).toHaveCount(2);
  expect(await photoOf("alice@friendloop.test", loop.groupId)).toBeNull();

  // Too large for a profile photo (2 MB), and not an image.
  await chooseFile(page, "Choose a photo of yourself", { name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(2 * 1024 * 1024 + 1) }, mine);
  await expect(mine.getByText("That photo is over 2 MB. Try a smaller one.")).toBeVisible();
  expect(await photoOf("owner@friendloop.test", loop.groupId)).toBe(url);
});

test("N5 · the photo routes answer only the person they belong to", async ({ request }) => {
  const { loop, alice } = await seedWorld();
  const form = { multipart: { photo: { name: "x.png", mimeType: "image/png", buffer: TINY_PNG } } };

  expect((await request.post("/api/reply/not-a-real-token/profile-photo", form)).status()).toBe(403);
  expect((await request.delete("/api/reply/not-a-real-token/profile-photo")).status()).toBe(403);
  expect((await request.post(`/api/loop/${loop.groupId}/profile-photo`, form)).status()).toBe(403);
  expect((await request.delete(`/api/loop/${loop.groupId}/profile-photo`)).status()).toBe(403);

  // A reader's link opens no sheet, so it sets no photo either.
  await rows("update memberships set participation = 'reader' where id = $1", [alice.id]);
  expect((await request.post(`/api/reply/${alice.token}/profile-photo`, form)).status()).toBe(403);

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
