import { test, expect, type Locator, type Page } from "../support/test";
import AxeBuilder from "@axe-core/playwright";
import { copy, copyPattern, text } from "@/lib/copy";
import { COVER_TINTS, SCRAPBOOK_PER_ROUND } from "@/lib/looks";
import { issueHeading, issueTitle } from "@/lib/issue-name";
import { resetDatabase, rows } from "../support/db";
import { DELIVERY_DAY, runSweep, signIn } from "../support/harness";
import { gotoScheme, seedWorld } from "../support/identity";

test.use({ reducedMotion: "reduce" });

test.beforeEach(async () => {
  await resetDatabase();
});

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const words = copy.issue.scrapbook;
const cover = copy.rounds.cover;
const LOOP_NAME = "Friday Loop";

/** Screenshots for a person to look at, only when asked for (`SHOTS_DIR=/tmp/x`). */
async function shot(page: Page, name: string, target?: Locator) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await (target ?? page).screenshot({ path: `${dir}/${name}.png`, ...(target ? {} : { fullPage: false }) });
}

async function expectAccessible(page: Page, label: string, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const result = await (include ? builder.include(include) : builder).analyze();
  expect(result.violations, `${label}: ${result.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ")}`).toEqual([]);
}

/** Two boxes that share any area. */
function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** What the page said about an answer's stickers, where it happened (a live region off the page says it too). */
const said = (page: Page, message: string) => page.locator(".scrap-note").filter({ hasText: message });

const stickersOf = async (membershipId: string) =>
  rows<{ id: string; sticker: string; side: string; offset: number }>("select id, sticker, side, \"offset\" from issue_stickers where membership_id = $1 order by created_at", [membershipId]);

test("N10 · the owner gives a named round a cover, and it's on the round, the rounds list and the email", async ({ page }) => {
  test.setTimeout(90_000);
  const { loop, open } = await seedWorld();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/issues`);

  const roundTitle = issueTitle(copy.rounds.round, open.number, null);
  await page.getByLabel(text(copy.a11yLabels.renameRound, { title: roundTitle })).click();
  const form = page.locator("details.round-rename[open]");
  // A cover waits for a name.
  const picker = form.getByRole("group", { name: cover.legend });
  await expect(picker).toHaveAttribute("disabled", "");
  await expect(picker.getByRole("radio", { name: copy.stickers.mushroom })).toBeDisabled();
  await expect(picker).toContainText(cover.needsName);

  await form.getByLabel(text(copy.rounds.nameLabel, { number: open.number })).fill("Camping weekend");
  await expect(picker).toBeEnabled();
  await picker.getByRole("radio", { name: copy.stickers.mushroom }).check();
  await picker.getByRole("radio", { name: cover.tints.plum }).check();
  // The preview is live: the cover with the name, and the email's opening line.
  const preview = form.locator(".round-cover--preview");
  await expect(preview).toContainText("Camping weekend");
  await expect(preview).toHaveAttribute("data-tint", "plum");
  await expect(form.locator(".email-line")).toHaveText(text(copy.emails.delivery.subject, { groupName: LOOP_NAME, issueHeading: issueHeading(open.number, "Camping weekend") }));
  await expectAccessible(page, "cover picker", "details.round-rename[open]");
  await form.scrollIntoViewIfNeeded();
  await shot(page, "cover-picker", form);

  await form.getByRole("button", { name: copy.rounds.nameSave }).click();
  await expect(page.getByText(copy.rounds.coverSaved)).toBeVisible();
  expect((await rows<{ cover_sticker: string; cover_tint: string }>("select cover_sticker, cover_tint from issues where id = $1", [open.issueId]))[0]).toEqual({ cover_sticker: "mushroom", cover_tint: "plum" });

  // The rounds list: a covered round is a little zine; the plain one is as it was.
  const covered = page.locator("li.round-card--covered");
  await expect(covered).toHaveCount(1);
  await expect(covered.locator(".zine-cover")).toContainText(text(cover.zine, { number: open.number }));
  await expect(covered.getByRole("heading", { name: "Camping weekend" })).toBeVisible();
  await expect(page.locator(".zine-cover")).toHaveCount(1);
  await expectAccessible(page, "rounds list with a zine");
  await shot(page, "archive-shelf");

  // The round's page opens with the cover, in both themes.
  for (const scheme of ["light", "dark"] as const) {
    await gotoScheme(page, `/i/${open.issueId}`, scheme);
    const band = page.locator(".round-cover");
    await expect(band).toHaveAttribute("data-tint", "plum");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Camping weekend");
    await expect(band.locator(".round-cover__no")).toHaveText(text(copy.issue.round, { number: open.number }));
    await expectAccessible(page, `covered round ${scheme}`);
  }

  // It goes out with the cover at the top of the email.
  await runSweep(DELIVERY_DAY);
  const [mail] = await rows<{ html: string }>("select html from outbox where kind = 'delivery' and issue_id = $1 and \"to\" = 'bob@friendloop.test'", [open.issueId]);
  expect(mail.html).toContain(`bgcolor="${COVER_TINTS.plum.tint}"`);
  expect(mail.html).toContain("/stickers/png/mushroom.png");
  expect(mail.html).toMatch(new RegExp(`<h1 style="[^"]*color:${COVER_TINTS.plum.ink};[^"]*">${copyPattern(text(copy.emails.delivery.heading, { issueHeading: "Camping weekend" })).source}</h1>`));
  if (process.env.SHOTS_DIR) {
    const origin = new URL(page.url()).origin;
    await page.setViewportSize({ width: 680, height: 900 });
    await page.setContent(mail.html.replaceAll(/https?:\/\/[^/"]+\/stickers\//g, `${origin}/stickers/`));
    await shot(page, "cover-email");
  }

  // The delivered round keeps the cover, the seal pressed on its corner.
  await rows("update groups set seal_style = 'wax' where id = $1", [loop.groupId]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoScheme(page, `/i/${open.issueId}`, "light");
  const seal = page.locator(".loop-head__page--cover > .round-mark");
  await expect(seal).toBeVisible();
  const [sealBox, stickerBox, chipBox] = await Promise.all([seal.boundingBox(), page.locator(".round-cover__sticker").boundingBox(), page.locator(".round-cover__no").boundingBox()]);
  expect(overlaps(sealBox!, stickerBox!), "the seal clears the sticker").toBe(false);
  expect(overlaps(sealBox!, chipBox!), "and the round's number").toBe(false);
  await shot(page, "covered-round-wide");

  // Clearing the name takes the cover with it.
  await page.goto(`/g/${loop.groupId}/issues`);
  await page.getByLabel(text(copy.a11yLabels.renameNamedRound, { title: "Camping weekend" })).click();
  await page.locator("details.round-rename[open]").getByLabel(text(copy.rounds.nameLabel, { number: open.number })).fill("");
  await page.locator("details.round-rename[open]").getByRole("button", { name: copy.rounds.nameSave }).click();
  await expect(page.getByText(copy.rounds.nameCleared)).toBeVisible();
  expect((await rows<{ cover_sticker: string | null }>("select cover_sticker from issues where id = $1", [open.issueId]))[0].cover_sticker).toBeNull();
  await expect(page.locator(".zine-cover")).toHaveCount(0);
});

test("N10 · a covered round, its picker and the list fit a phone", async ({ browser }) => {
  const { loop, open } = await seedWorld();
  await rows("update issues set name = 'Camping weekend with everyone', cover_sticker = 'frog', cover_tint = 'butter' where id = $1", [open.issueId]);
  await rows("update groups set seal_style = 'postmark' where id = $1", [loop.groupId]);
  const owner = loop.members.find((member) => member.email.startsWith("owner"))!;
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
  const page = await context.newPage();
  await signIn(page, "owner@friendloop.test");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  await page.goto(`/g/${loop.groupId}/issues`);
  await expect(page.locator(".zine-cover")).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(1);
  await shot(page, "archive-shelf-phone");
  await page.getByLabel(text(copy.a11yLabels.renameNamedRound, { title: "Camping weekend with everyone" })).click();
  const form = page.locator("details.round-rename[open]");
  await expect(form.getByRole("radio", { name: copy.stickers.frog })).toBeChecked();
  await expect(form.getByRole("radio", { name: cover.tints.butter })).toBeChecked();
  for (const radio of await form.locator(".cover-sticker, .cover-tint").all()) {
    const box = (await radio.boundingBox())!;
    expect(Math.min(box.width, box.height), "a finger's worth").toBeGreaterThanOrEqual(44);
  }
  expect(await overflow()).toBeLessThanOrEqual(1);
  await form.locator(".cover-picker").scrollIntoViewIfNeeded();
  await shot(page, "cover-picker-phone");

  await page.goto(`/i/${open.issueId}?m=${owner.token}`);
  await expect(page.locator(".round-cover")).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(1);
  await shot(page, "covered-round-phone");
  await context.close();
});

test("N10 · members stick, move and peel stickers in a delivered round's margins, three each, and everyone sees who stuck them", async ({ page }) => {
  test.setTimeout(120_000);
  const { loop, delivered, alice } = await seedWorld();
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  const owner = loop.members.find((member) => member.email.startsWith("owner"))!;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/i/${delivered.issueId}?m=${bob.token}`);

  const whose = text(copy.issue.whoseAnswerNumbered, { author: "Alice", number: 1 });
  // Stickers live in the reaction sheet, on its Stickers tab.
  const addLabel = text(copy.issue.reactMoreTo, { whose });
  const stick = page.getByRole("button", { name: addLabel });
  const sheet = page.getByRole("dialog", { name: addLabel });
  const openStickers = async () => {
    await stick.click();
    await sheet.getByRole("tab", { name: copy.emojiPicker.tabStickers }).click();
  };
  await openStickers();
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(text(words.left, { count: SCRAPBOOK_PER_ROUND }));
  await expectAccessible(page, "scrapbook sheet", ".emoji-picker");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(stick).toBeFocused();

  for (const [index, key] of (["frog", "heart", "star"] as const).entries()) {
    await openStickers();
    await sheet.getByRole("button", { name: copy.stickers[key] }).click();
    const left = SCRAPBOOK_PER_ROUND - index - 1;
    const leftLine = left === 1 ? words.leftOne : left > 1 ? text(words.left, { count: left }) : text(words.spent, { limit: SCRAPBOOK_PER_ROUND });
    await expect(said(page, text(words.stuck, { sticker: copy.stickers[key], left: leftLine }))).toBeVisible();
    await expect(page.getByRole("button", { name: text(words.labelYours, { sticker: copy.stickers[key] }) })).toBeVisible();
  }
  await expect.poll(async () => (await stickersOf(bob.id)).length).toBe(SCRAPBOOK_PER_ROUND);
  // A fourth: the sheet closes and says why.
  await openStickers();
  await sheet.getByRole("button", { name: copy.stickers.frog }).click();
  await expect(sheet).toBeHidden();
  await expect(said(page, text(words.spent, { limit: SCRAPBOOK_PER_ROUND }))).toBeVisible();
  // Screen readers hear it from one live region, outside the round.
  await expect(page.locator("body > p[aria-live='polite']").filter({ hasText: text(words.spent, { limit: SCRAPBOOK_PER_ROUND }) })).toHaveCount(1);

  // Nothing covers a word.
  const answerText = (await page.locator("article.answer-card .answer-text").first().boundingBox())!;
  for (const sticker of await page.locator(".scrap-sticker").all()) {
    expect(overlaps((await sticker.boundingBox())!, answerText), "a sticker sits in the margin").toBe(false);
  }
  await expectAccessible(page, "round with stickers");
  await shot(page, "scrapbook-wide");

  // The keyboard: a menu to move it along, across, or peel it off.
  const frog = page.getByRole("button", { name: text(words.labelYours, { sticker: copy.stickers.frog }) });
  const frogId = (await stickersOf(bob.id)).find((row) => row.sticker === "frog")!.id;
  const frogRow = async () => (await rows<{ side: string; offset: number }>("select side, \"offset\" from issue_stickers where id = $1", [frogId]))[0];
  const before = await frogRow();
  await frog.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("group", { name: text(words.menuLabel, { sticker: copy.stickers.frog, name: copy.issue.you }) });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText(words.stuckByYou);
  await expectAccessible(page, "sticker menu", ".scrap-menu");
  const swap = before.side === "left" ? words.swapRight : words.swapLeft;
  await menu.getByRole("button", { name: swap }).click();
  await expect.poll(async () => (await frogRow()).side).toBe(before.side === "left" ? "right" : "left");
  const moveDown = menu.getByRole("button", { name: words.moveDown });
  const moveUp = menu.getByRole("button", { name: words.moveUp });
  await (before.offset >= 100 ? moveUp : moveDown).click();
  await expect.poll(async () => (await frogRow()).offset).not.toBe(before.offset);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(frog).toBeFocused();
  // Arrow keys move it too.
  const offsetNow = (await frogRow()).offset;
  await page.keyboard.press(offsetNow >= 100 ? "ArrowUp" : "ArrowDown");
  await expect.poll(async () => (await frogRow()).offset).not.toBe(offsetNow);

  // A drag with the mouse carries it to the other margin.
  const heart = page.getByRole("button", { name: text(words.labelYours, { sticker: copy.stickers.heart }) });
  const heartRow = async () => (await stickersOf(bob.id)).find((row) => row.sticker === "heart")!;
  const heartBefore = await heartRow();
  const card = (await page.locator("article.answer-card").first().boundingBox())!;
  const from = (await heart.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  const toX = heartBefore.side === "left" ? card.x + card.width + 10 : card.x - 10;
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(from.x + ((toX - from.x) * step) / 8, card.y + card.height * 0.7);
  }
  await expect(heart).toHaveClass(/is-dragging/);
  await shot(page, "scrapbook-wide-drag");
  await page.mouse.up();
  await expect.poll(async () => (await heartRow()).side).toBe(heartBefore.side === "left" ? "right" : "left");

  // Peel one off: one back to spend.
  const star = page.getByRole("button", { name: text(words.labelYours, { sticker: copy.stickers.star }) });
  await star.click();
  await page.getByRole("group", { name: text(words.menuLabel, { sticker: copy.stickers.star, name: copy.issue.you }) }).getByRole("button", { name: words.peel }).click();
  await expect(said(page, text(words.peeled, { left: words.leftOne }))).toBeVisible();
  await expect.poll(async () => (await stickersOf(bob.id)).length).toBe(SCRAPBOOK_PER_ROUND - 1);
  await expect(stick).toBeFocused();

  // Alice sees who stuck them, and can't rearrange or peel Bob's.
  await page.goto(`/i/${delivered.issueId}?m=${alice.token}`);
  const seen = page.getByRole("button", { name: text(words.label, { sticker: copy.stickers.frog, name: "Bob" }) });
  await expect(seen).toBeVisible();
  await expect(seen).not.toHaveAttribute("aria-haspopup", /.*/);
  await seen.click();
  await expect(seen.locator(".scrap-sticker__tag")).toHaveText(text(words.stuckBy, { name: "Bob" }));
  await expect(page.locator(".scrap-menu")).toHaveCount(0);
  for (const scheme of ["light", "dark"] as const) {
    await gotoScheme(page, `/i/${delivered.issueId}?m=${alice.token}`, scheme);
    await expectAccessible(page, `round with Bob's stickers, ${scheme}`);
  }

  // The owner can peel anyone's.
  await page.goto(`/i/${delivered.issueId}?m=${owner.token}`);
  const moderated = page.getByRole("button", { name: text(words.labelModerate, { sticker: copy.stickers.heart, name: "Bob" }) });
  await moderated.click();
  const ownersMenu = page.getByRole("group", { name: text(words.menuLabel, { sticker: copy.stickers.heart, name: "Bob" }) });
  await expect(ownersMenu.getByRole("button", { name: words.moveUp })).toHaveCount(0);
  await ownersMenu.getByRole("button", { name: words.peel }).click();
  await expect(said(page, text(words.peeledTheirs, { name: "Bob", sticker: copy.stickers.heart }))).toBeVisible();
  await expect.poll(async () => (await stickersOf(bob.id)).length).toBe(1);

  // A share link shows them, read-only; an open round has no way to stick at all.
  await page.goto("/s/world-share-token");
  await expect(page.locator(".scrap-sticker")).toHaveCount(1);
  await expect(page.getByRole("button", { name: copyPattern(words.stick) })).toHaveCount(0);
});

test("N10 · on a phone stickers sit half off the card's edge, clear of the words, and drag by touch", async ({ browser, browserName }) => {
  const { loop, delivered, alice } = await seedWorld();
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  const [reply] = await rows<{ id: string }>("select id from replies where issue_id = $1 and membership_id = $2", [delivered.issueId, alice.id]);
  await rows(
    "insert into issue_stickers (issue_id, reply_id, membership_id, sticker, side, \"offset\", tilt) values ($1, $2, $3, 'frog', 'left', 0, -8), ($1, $2, $3, 'duck', 'right', 100, 10), ($1, $2, $4, 'peach', 'right', 0, 6)",
    [delivered.issueId, reply.id, bob.id, alice.id],
  );
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`/i/${delivered.issueId}?m=${bob.token}`);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  const stickers = page.locator(".scrap-sticker");
  await expect(stickers).toHaveCount(3);
  expect(await overflow()).toBeLessThanOrEqual(1);
  const cardBox = (await page.locator("section[id^='question-']").first().boundingBox())!;
  const answerText = (await page.locator(".answer-text").first().boundingBox())!;
  for (const sticker of await stickers.all()) {
    const box = (await sticker.boundingBox())!;
    expect(overlaps(box, answerText), "clear of the words").toBe(false);
    const edge = box.x < cardBox.x + cardBox.width / 2 ? cardBox.x : cardBox.x + cardBox.width;
    expect(Math.abs(box.x + box.width / 2 - edge), "straddling the card's edge").toBeLessThanOrEqual(5);
    expect(box.width).toBeLessThan(40);
  }
  await page.locator("section[id^='question-']").first().scrollIntoViewIfNeeded();
  await shot(page, "scrapbook-phone");

  // Only Chromium takes raw touch moves from a test (through its DevTools protocol).
  if (browserName !== "chromium") return context.close();
  // Drag Bob's frog down the left margin and across to the right, by finger.
  const frog = page.getByRole("button", { name: text(words.labelYours, { sticker: copy.stickers.frog }) });
  await frog.scrollIntoViewIfNeeded();
  const box = (await frog.boundingBox())!;
  const article = (await page.locator("article.answer-card").first().boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await touch("touchStart", startX, startY);
  const endX = cardBox.x + cardBox.width - 4;
  const endY = article.y + article.height * 0.6;
  for (let step = 1; step <= 10; step += 1) await touch("touchMove", startX + ((endX - startX) * step) / 10, startY + ((endY - startY) * step) / 10);
  await expect(frog).toHaveClass(/is-dragging/);
  await shot(page, "scrapbook-phone-drag");
  await touch("touchEnd", endX, endY);
  expect(await page.evaluate(() => window.scrollY), "the page didn't scroll under the finger").toBe(scrollBefore);
  await expect.poll(async () => (await rows<{ side: string; offset: number }>("select side, \"offset\" from issue_stickers where membership_id = $1 and sticker = 'frog'", [bob.id]))[0]).toMatchObject({ side: "right" });
  const moved = (await rows<{ offset: number }>("select \"offset\" from issue_stickers where membership_id = $1 and sticker = 'frog'", [bob.id]))[0];
  expect(moved.offset).toBeGreaterThan(20);
  expect(await overflow()).toBeLessThanOrEqual(1);
  await expectAccessible(page, "phone round with stickers");
  await context.close();
});
