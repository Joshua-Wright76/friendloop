import { test, expect } from "../support/test";
import AxeBuilder from "@axe-core/playwright";
import { resetDatabase, rows } from "../support/db";
import { DELIVERY_DAY, runSweep, signIn } from "../support/harness";
import { seedWorld } from "../support/identity";
import { openPerson } from "../support/people";
import { copy } from "@/lib/copy";

test.use({ reducedMotion: "reduce" });

test.beforeEach(async () => {
  await resetDatabase();
});

const lookOf = async (id: string) =>
  (await rows<{ charm: string | null; avatar_frame: string | null }>("select charm, avatar_frame from memberships where id = $1", [id]))[0];

test("N7 · a contributor picks a charm and frame on their reply sheet, and they follow their name into the issue and the email", async ({ page }) => {
  const { loop, delivered, alice } = await seedWorld();
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  await page.goto(`/r/${alice.token}`);
  await page.locator("details.reply-identity summary").click();
  const look = page.getByTestId("member-look");
  await look.getByRole("radio", { name: "Frog" }).check();
  await expect.poll(() => lookOf(alice.id)).toEqual({ charm: "frog", avatar_frame: null });
  await look.getByRole("radio", { name: copy.identity.look.frames.doily }).check();
  await expect.poll(() => lookOf(alice.id)).toEqual({ charm: "frog", avatar_frame: "doily" });
  await expect(look.getByText(copy.identity.look.saved)).toBeVisible();
  await expect(page.locator("details.reply-identity summary .avatar")).toHaveAttribute("data-frame", "doily");

  const axe = await new AxeBuilder({ page }).include('[data-testid="member-look"]').withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(axe.violations.map((violation) => violation.id)).toEqual([]);

  // Another member reading the round sees both, beside the printed name.
  await page.goto(`/i/${delivered.issueId}?m=${bob.token}`);
  const answer = page.locator("article.answer-card").first();
  await expect(answer.locator('img.name-charm[src="/stickers/frog.svg"]')).toBeVisible();
  await expect(answer.locator(".avatar")).toHaveAttribute("data-frame", "doily");
  await expect(answer.getByText("Alice", { exact: true })).toBeVisible();

  // The email shows the charm as a picture; the name doesn't depend on it.
  await runSweep(DELIVERY_DAY);
  const [mail] = await rows<{ html: string; text: string }>("select html, text from outbox where kind = 'delivery' limit 1");
  expect(mail.html).toContain("/stickers/png/frog.png");
  expect(mail.text).toContain("Alice");
  expect(mail.text).not.toContain("frog");

  // None takes them both away again.
  await page.goto(`/r/${alice.token}`);
  await page.locator("details.reply-identity summary").click();
  await page.getByTestId("member-look").getByRole("group", { name: copy.identity.look.charmLegend }).getByRole("radio", { name: copy.identity.look.none }).check();
  await expect.poll(async () => (await lookOf(alice.id)).charm).toBeNull();
  await page.getByTestId("member-look").getByRole("group", { name: copy.identity.look.frameLegend }).getByRole("radio", { name: copy.identity.look.none }).check();
  await expect.poll(() => lookOf(alice.id)).toEqual({ charm: null, avatar_frame: null });
});

test("N7 · a signed-in member sets theirs on the people page, for this loop only", async ({ page }) => {
  const { loop, alice } = await seedWorld();
  await rows("update memberships set accepted_at = now() where id = $1", [alice.id]);
  const owner = loop.members.find((member) => member.email.startsWith("owner"))!;
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/members`);

  await openPerson(page, "Sam");
  await page.getByText(copy.identity.look.open).click();
  const look = page.getByTestId("member-look");
  await look.getByRole("radio", { name: "Moon" }).check();
  await expect.poll(async () => (await lookOf(owner.id)).charm).toBe("moon");
  await look.getByRole("radio", { name: copy.identity.look.frames.stamp }).check();
  await expect.poll(async () => (await lookOf(owner.id)).avatar_frame).toBe("stamp");
  expect(await lookOf(alice.id)).toEqual({ charm: null, avatar_frame: null });

  await page.reload();
  await expect(page.locator('img.name-charm[src="/stickers/moon.svg"]')).toBeVisible();
  await expect(page.locator('.avatar[data-frame="stamp"]').first()).toBeVisible();

  // The look is yours alone: nobody else's row offers one.
  await openPerson(page, "Sam");
  await expect(page.getByText(copy.identity.look.open)).toHaveCount(1);
  await page.getByText(copy.identity.look.open).click();
  await expect(page.getByRole("radio", { name: "Moon" })).toBeChecked();
});

test("N7 · the routes only take our own stickers, and only from the person they belong to", async ({ page, request }) => {
  const { loop, alice } = await seedWorld();
  const send = (data: unknown, token = alice.token) => request.patch(`/api/reply/${token}/profile-photo`, { data });

  expect((await send({ charm: "frog" })).status()).toBe(200);
  for (const bad of [{ charm: "../../secrets" }, { frame: "<script>" }, { charm: 7 }, null]) {
    expect((await send(bad)).status(), JSON.stringify(bad)).toBe(400);
  }
  expect((await send({ charm: "bee" }, "not-a-real-token")).status()).toBe(403);
  expect(await lookOf(alice.id)).toEqual({ charm: "frog", avatar_frame: null });

  // No session, no signed-in route.
  expect((await page.request.patch(`/api/loop/${loop.groupId}/profile-photo`, { data: { charm: "bee" } })).status()).toBe(403);
});
