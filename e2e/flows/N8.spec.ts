import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resetDatabase, rows } from "../support/db";
import { DELIVERY_DAY, openPart, runSweep, signIn, uniqueEmail } from "../support/harness";
import { cssVar, gotoScheme, seedWorld } from "../support/identity";
import { copy, copyPattern, text } from "@/lib/copy";

test.use({ reducedMotion: "reduce" });

test.beforeEach(async () => {
  await resetDatabase();
});

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const NEXT = copy.newLoop.wizard.nextAriaLabel;
const S = copy.stationery;
/** A choice's radio: its name, then its description. */
const choice = (name: string) => copyPattern(name, { start: true });

type Marks = { motto: string | null; sign_off: string | null; seal_style: string | null; seal_color: string | null; divider: string | null; celebration: string | null };

const marks = async (groupId: string): Promise<Marks> =>
  (await rows<Marks>("select motto, sign_off, seal_style, seal_color, divider, celebration from groups where id = $1", [groupId]))[0];

async function expectAccessible(page: Page, label: string) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  });
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(result.violations, `${label}: ${result.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ")}`).toEqual([]);
}

test("N8 · the owner sets a motto, sign-off, seal, divider and celebration, and a delivered round wears them", async ({ page }) => {
  const { loop, delivered, alice } = await seedWorld("n8-share-token");
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/settings`);
  await openPart(page, copy.settings.groupPaper);

  // Nothing chosen is stored as nothing.
  await expect(page.getByRole("radio", { name: choice(S.seals.none.name) })).toBeChecked();
  await expect(page.getByRole("radio", { name: choice(S.dividers.stitches) })).toBeChecked();
  await expect(page.getByRole("radio", { name: choice(S.celebrations.none) })).toBeChecked();
  expect(await marks(loop.groupId)).toEqual({ motto: null, sign_off: null, seal_style: null, seal_color: null, divider: null, celebration: null });

  // Words save when the field is left, and the preview shows them as they're typed.
  await page.getByLabel(S.mottoLabel).fill("est. 2019 · still <terrible> at replying");
  await expect(page.getByTestId("preview-motto").first()).toHaveText("est. 2019 · still <terrible> at replying");
  await page.getByLabel(S.mottoLabel).blur();
  await expect.poll(async () => (await marks(loop.groupId)).motto).toBe("est. 2019 · still <terrible> at replying");
  await page.getByLabel(S.signOffLabel).fill("  xo,\n the   Friday crew ");
  await page.getByLabel(S.signOffLabel).press("Enter");
  await expect.poll(async () => (await marks(loop.groupId)).sign_off).toBe("xo, the Friday crew");

  // Each choice saves as it's made.
  await page.getByRole("radio", { name: choice(S.seals.wax.name) }).check();
  await expect.poll(async () => (await marks(loop.groupId)).seal_style).toBe("wax");
  await page.getByRole("radio", { name: copyPattern(S.waxes.moss, { start: true, end: true }) }).check();
  await expect.poll(async () => (await marks(loop.groupId)).seal_color).toBe("moss");
  await page.getByRole("radio", { name: choice(S.dividers.ricrac) }).check();
  await expect.poll(async () => (await marks(loop.groupId)).divider).toBe("ricrac");
  await page.getByRole("radio", { name: choice(S.celebrations.hop) }).check();
  await expect.poll(() => marks(loop.groupId)).toEqual({
    motto: "est. 2019 · still <terrible> at replying",
    sign_off: "xo, the Friday crew",
    seal_style: "wax",
    seal_color: "moss",
    divider: "ricrac",
    celebration: "hop",
  });
  await expectAccessible(page, "settings");

  // A second answer, so there is something for the divider to sit between.
  const [question] = await rows<{ id: string }>("select id from issue_questions where issue_id = $1 order by position limit 1", [delivered.issueId]);
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await rows(
    "insert into replies (issue_id, issue_question_id, membership_id, body, status, submitted_at) values ($1, $2, $3, 'Bob saw it too.', 'submitted', now())",
    [delivered.issueId, question.id, bob.id],
  );

  // The delivered round, in both schemes: motto, seal, divider and sign-off, all readable.
  for (const scheme of ["light", "dark"] as const) {
    await gotoScheme(page, `/i/${delivered.issueId}?m=${alice.token}`, scheme);
    await expect(page.locator(".loop-motto")).toHaveText("est. 2019 · still <terrible> at replying");
    await expect(page.locator(".loop-head .wax-seal[data-wax=moss]")).toBeVisible();
    await expect(page.locator(".loop-head .wax-seal")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".sign-off")).toContainText("xo, the Friday crew");
    await expect(page.locator(".sign-off")).toContainText(copyPattern(copy.issue.signOffNext, { values: { round: text(copy.issue.round, { number: 2 }) } }));
    expect(await cssVar(page, "--divider"), scheme).toContain("data:image/svg+xml");
    const divided = page.locator(".answer-card.divided").nth(1);
    expect(await divided.evaluate((el) => getComputedStyle(el).borderImageSource)).toContain("data:image/svg+xml");
    await expectAccessible(page, `round ${scheme}`);
  }
  // The sign-off closes the round, before the talk about it.
  const order = await page.evaluate((title) => {
    const signOff = document.querySelector(".sign-off")!;
    const comments = [...document.querySelectorAll("h2")].find((heading) => heading.textContent === title)!;
    return signOff.compareDocumentPosition(comments) & Node.DOCUMENT_POSITION_FOLLOWING;
  }, copy.issue.comments);
  expect(order).toBeTruthy();

  // The share view wears them too.
  await page.goto("/s/n8-share-token");
  await expect(page.locator(".loop-motto")).toBeVisible();
  await expect(page.locator(".loop-head .wax-seal")).toBeVisible();
  await expect(page.locator(".sign-off")).toContainText("xo, the Friday crew");

  // A postmark carries the round and the day it went out, in the loop's own zone.
  await rows("update groups set seal_style = 'postmark' where id = $1", [loop.groupId]);
  await page.goto(`/i/${delivered.issueId}?m=${alice.token}`);
  await expect(page.locator(".loop-head .postmark-mark")).toBeVisible();
  await expect(page.locator(".loop-head .postmark-mark")).toContainText(text(copy.issue.round, { number: 1 }).toUpperCase());

  // The next round's email carries the motto, the stamp, the divider and the sign-off.
  await rows("update groups set seal_style = 'wax' where id = $1", [loop.groupId]);
  await runSweep(DELIVERY_DAY);
  const [mail] = await rows<{ html: string; text: string }>("select html, text from outbox where kind = 'delivery' limit 1");
  expect(mail.html).toContain("est. 2019 · still &lt;terrible&gt; at replying");
  expect(mail.html).toContain("/seals/wax-cherries-moss.png");
  expect(mail.html).toContain("xo, the Friday crew");
  expect(mail.text).toContain("xo, the Friday crew");
  const png = await page.request.get("/seals/wax-cherries-moss.png");
  expect(png.ok()).toBe(true);
  expect(png.headers()["content-type"]).toContain("image/png");
});

test("N8 · the send celebration plays once over the confirmation, and never for reduced motion", async ({ page }) => {
  const { loop, alice } = await seedWorld();
  await rows("update groups set celebration = 'confetti' where id = $1", [loop.groupId]);

  // Asked for less motion: just the confirmation.
  await page.goto(`/r/${alice.token}`);
  await page.getByRole("button", { name: copy.reply.done, exact: true }).click();
  await expect(page.getByRole("heading", { name: copy.reply.confirmation.title })).toBeVisible();
  await expect(page.getByTestId("celebration")).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`/r/${alice.token}`);
  await page.getByRole("button", { name: copy.reply.done, exact: true }).click();
  await expect(page.getByRole("heading", { name: copy.reply.confirmation.title })).toBeVisible();
  const layer = page.getByTestId("celebration");
  await expect(layer).toBeAttached();
  await expect(layer).toHaveAttribute("aria-hidden", "true");
  expect(await layer.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  // Taps go through it to the page underneath.
  await page.getByRole("button", { name: copy.reply.confirmation.edit }).click({ trial: true });
  // It plays once and goes.
  await expect(layer).toHaveCount(0, { timeout: 6_000 });
});

test("N8 · a loop with no marks reads exactly as before", async ({ page }) => {
  const { delivered, alice } = await seedWorld("n8-plain-token");
  await page.goto(`/i/${delivered.issueId}?m=${alice.token}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const selector of [".loop-motto", ".wax-seal", ".postmark-mark", ".sign-off"]) await expect(page.locator(selector)).toHaveCount(0);
  expect(await cssVar(page, "--divider")).toBe("");
});

test("N8 · the wizard offers the marks, previews them, and creates the loop with them", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await page.goto("/g/new");
  await page.getByLabel(copy.newLoop.nameLabel).fill("Marked Up");
  await page.getByRole("button", { name: NEXT }).click();
  await expect(page.getByRole("heading", { name: copy.newLoop.wizard.look.title })).toBeVisible();

  await page.getByLabel(S.mottoLabel).fill("still terrible at replying");
  await page.getByLabel(S.signOffLabel).fill("xo, everyone");
  await expect(page.getByTestId("preview-sign-off").first()).toHaveText("xo, everyone");
  await page.getByRole("radio", { name: choice(S.seals.postmark.name) }).check();
  await expect(page.getByTestId("stationery-preview-light").locator(".postmark-mark")).toBeVisible();
  await page.getByRole("radio", { name: choice(S.dividers.vine) }).check();
  await page.getByRole("radio", { name: choice(S.celebrations.petals) }).check();

  for (let index = 0; index < 3; index += 1) await page.getByRole("button", { name: NEXT }).click();
  await expect(page.getByText(copyPattern([S.seals.postmark.name, S.dividers.vine, S.celebrations.petals].join(" · ")))).toBeVisible();
  await page.getByRole("button", { name: copy.newLoop.wizard.create }).click();
  await expect(page).toHaveURL(/\/g\/([0-9a-f-]+)\?welcome=1/);
  await expect(page.locator(".loop-motto")).toHaveText("still terrible at replying");

  const [group] = await rows<Marks>("select motto, sign_off, seal_style, seal_color, divider, celebration from groups where name = 'Marked Up'");
  expect(group).toEqual({ motto: "still terrible at replying", sign_off: "xo, everyone", seal_style: "postmark", seal_color: null, divider: "vine", celebration: "petals" });
});

test("N8 · only the owner can set the marks", async ({ page }) => {
  const { loop } = await seedWorld();
  await signIn(page, "alice@friendloop.test");
  await page.goto(`/g/${loop.groupId}/settings`);
  await expect(page.getByLabel(S.mottoLabel)).toHaveCount(0);
});
