import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { enableShare } from "../support/audio";
import { seedAlbum } from "../support/album";
import { signIn } from "../support/harness";
import { copy } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("P3 · share-link visitors get no Album, and strangers, revoked members and other loops' members get a plain not-found", async ({ page, request }) => {
  const world = await seedAlbum();
  await enableShare({ groupId: world.loop.groupId, issueId: world.round2, shareToken: "album-share-token" });

  // The shared round carries no door to the archive.
  await page.goto("/s/album-share-token");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: copy.album.issueLink })).toHaveCount(0);
  await expect(page.locator('a[href*="/album/"]')).toHaveCount(0);

  // The share token opens nothing here, as a token or any other way.
  for (const path of [
    `/album/${world.loop.groupId}`,
    `/album/${world.loop.groupId}?m=album-share-token`,
    `/album/${world.loop.groupId}?m=not-a-token`,
    `/album/not-a-uuid`,
    `/album/${world.loop.groupId}?m=${world.alice.token}x`,
  ]) {
    // Streamed pages may have sent their 200 before the lookup missed, so the
    // proof is the screen and the bytes, not only the status.
    const body = await (await request.get(path)).text();
    expect(body, path).not.toContain("Tent at dawn");
    expect(body, path).not.toContain("/uploads/");
    expect(body, path).not.toContain("album-grid");
    await page.goto(path);
    await expect(page.getByRole("heading", { name: copy.common.notFound.title }), path).toBeVisible();
  }

  // A revoked member's link stops working, album included.
  await rows("update memberships set revoked_at = now() where id = $1", [world.bob.id]);
  const revoked = await (await request.get(`/album/${world.loop.groupId}?m=${world.bob.token}`)).text();
  expect(revoked).not.toContain("album-grid");
  await page.goto(`/album/${world.loop.groupId}?m=${world.bob.token}`);
  await expect(page.getByRole("heading", { name: copy.common.notFound.title })).toBeVisible();

  // A signed-out visit to the signed-in route goes to sign-in, with no data in the way.
  await page.goto(`/g/${world.loop.groupId}/album`);
  await expect(page).toHaveURL(/\/signin/);

  // Someone signed in to a different loop sees nothing of this one.
  await signIn(page, "stranger@friendloop.test");
  await page.goto(`/g/${world.loop.groupId}/album`);
  await expect(page.getByRole("heading", { name: copy.common.notFound.title })).toBeVisible();
  await expect(page.getByText("Tent at dawn")).toHaveCount(0);
  await page.goto(`/album/${world.loop.groupId}`);
  await expect(page.getByRole("heading", { name: copy.common.notFound.title })).toBeVisible();
  await expect(page.getByText("Tent at dawn")).toHaveCount(0);
});

test("P3 · a member can read the Album and the media links stay content-hashed, long and unguessable", async ({ page }) => {
  const world = await seedAlbum();
  await page.goto(`/album/${world.loop.groupId}?m=${world.alice.token}`);
  const sources = await page.locator(".album-grid img, .album-grid audio").evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLImageElement | HTMLAudioElement).getAttribute("src")),
  );
  expect(sources.length).toBe(7);
  for (const source of sources) expect(source).toMatch(/^\/uploads\/[a-f0-9]{64}\.(png|webm)$/);

  // Guessing a neighbour of a real file finds nothing.
  const response = await page.request.get(`/uploads/${"0".repeat(64)}.png`);
  expect(response.status()).toBe(404);
});
