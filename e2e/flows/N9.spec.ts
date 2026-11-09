import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resetDatabase, rows } from "../support/db";
import { copy, copyPattern, text } from "@/lib/copy";
import { STATUS_LINE_MAX } from "@/lib/looks";
import { DELIVERY_DAY, runSweep, signIn, waitForSheet } from "../support/harness";
import { gotoScheme, seedWorld } from "../support/identity";

test.use({ reducedMotion: "reduce" });

test.beforeEach(async () => {
  await resetDatabase();
});

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const signature = copy.identity.signature;
const signedBy = (name: string) => text(copy.signatures.signed, { name });
/** "🧳 off to…": the starter fills the field without its ellipsis, and the rest is typed after it. */
const STARTER = copy.reply.statusLine.starters[3];
const TYPED = "Lisbon on Thursday";
const LINE = `${STARTER.replace(/…$/, "").trimEnd()} ${TYPED}`;

async function expectAccessible(page: Page, label: string, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const result = await (include ? builder.include(include) : builder).analyze();
  expect(result.violations, `${label}: ${result.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ")}`).toEqual([]);
}

/** Sign the pad with the mouse: a few loops and an underline, each stroke found afresh (its buttons appear as it's drawn). */
async function drawSignature(page: Page) {
  const pad = page.getByRole("img", { name: signature.padLabel });
  const stroke = async (points: Array<[number, number]>) => {
    await pad.scrollIntoViewIfNeeded();
    const box = (await pad.boundingBox())!;
    const at = (x: number, y: number) => [box.x + x * box.width, box.y + y * box.height] as const;
    await page.mouse.move(...at(...points[0]));
    await page.mouse.down();
    for (const point of points.slice(1)) await page.mouse.move(...at(...point));
    await page.mouse.up();
  };
  const loops: Array<[number, number]> = [];
  for (let t = 0; t < Math.PI * 6; t += 0.3) loops.push([0.1 + t / 26 + Math.cos(t) * 0.04, 0.55 - Math.sin(t) * 0.25]);
  await stroke(loops);
  await stroke([[0.5, 0.8], [0.55, 0.79], [0.6, 0.78], [0.65, 0.76], [0.7, 0.75]]);
}

const signatureOf = async (id: string) =>
  (await rows<{ kind: string | null; url: string | null }>("select jsonb_typeof(signature) as kind, signature_png_url as url from memberships where id = $1", [id]))[0];

test("N9 · a contributor signs, writes a line and sticks a sticker while answering, and the delivered round wears all three", async ({ page }) => {
  test.setTimeout(90_000);
  const { loop, open, alice } = await seedWorld();
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);

  // The line: a starter fills the field and the rest is typed; it saves like an answer.
  await page.getByRole("button", { name: STARTER }).click();
  await expect(page.getByRole("textbox", { name: copyPattern(copy.reply.statusLine.label) })).toBeFocused();
  await page.keyboard.type(TYPED);
  await expect(page.getByText(text(copy.reply.statusLine.count, { count: [...LINE].length, max: STATUS_LINE_MAX }))).toBeVisible();
  await expect.poll(async () => (await rows<{ body: string }>("select body from issue_status_lines where membership_id = $1", [alice.id]))[0]?.body).toBe(LINE);

  // A sticker: the sheet is a modal dialog, Escape closes it and focus comes back.
  const stick = page.getByRole("button", { name: text(copy.a11yLabels.forQuestionNumber, { label: copy.reply.sticker.addLabel, n: 1 }) });
  await stick.click();
  const sheet = page.getByRole("dialog", { name: copy.reply.sticker.sheetTitle });
  await expect(sheet).toBeVisible();
  await expectAccessible(page, "sticker sheet", ".sticker-picker");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(stick).toBeFocused();
  await stick.click();
  await sheet.getByRole("button", { name: copy.stickers.frog }).click();
  await expect(page.getByText(text(copy.reply.sticker.stuck, { sticker: copy.stickers.frog }))).toBeVisible();
  await expect.poll(async () => (await rows<{ sticker: string | null }>("select sticker from replies where membership_id = $1 and issue_id = $2 and body <> ''", [alice.id, open.issueId]))[0]?.sticker).toBe("frog");
  // A card with nothing in it says so instead of opening the sheet.
  // aria-disabled, so it stays in the tab order and can say why.
  await page.getByRole("button", { name: text(copy.a11yLabels.forQuestionNumber, { label: copy.reply.sticker.addLabel, n: 2 }) }).click({ force: true });
  await expect(page.getByText(copy.reply.sticker.needsAnswer)).toBeVisible();
  await expect(sheet).toBeHidden();

  // The signature, drawn on the pad beside the charm and frame.
  await page.locator("details.reply-identity summary").click();
  await drawSignature(page);
  await page.getByRole("button", { name: signature.use }).click();
  await expect(page.getByText(signature.saved)).toBeVisible();
  const signed = await signatureOf(alice.id);
  expect(signed.kind).toBe("array");
  const png = await page.request.get(signed.url!);
  expect(png.ok()).toBe(true);
  expect(png.headers()["content-type"]).toContain("image/png");
  await expectAccessible(page, "member look with the pad", '[data-testid="member-look"]');

  // The round goes out; the email opens with the roll call and closes with the signed card.
  await runSweep(DELIVERY_DAY);
  const [mail] = await rows<{ html: string; text: string }>("select html, text from outbox where kind = 'delivery' and issue_id = $1 and \"to\" = 'bob@friendloop.test'", [open.issueId]);
  expect(mail.html).toContain(copy.emails.rollCallTitle.replaceAll("'", "&#39;"));
  expect(mail.html).toContain(LINE);
  expect(mail.html).toContain("/stickers/png/frog.png");
  expect(mail.html).toContain(`<img src="${signed.url}" alt="${signedBy("Alice")}"`);
  expect(mail.text).toContain(text(copy.emails.rollCallText, { name: "Alice", line: LINE }));
  expect(mail.text).toContain(text(copy.emails.signedText, { names: "Alice" }));

  // Bob reads it: the roll call at the top, the sticker by Alice's answer, the signed card at the end.
  for (const scheme of ["light", "dark"] as const) {
    await gotoScheme(page, `/i/${open.issueId}?m=${bob.token}`, scheme);
    const rollCall = page.getByRole("region", { name: copy.issue.rollCallTitle });
    await expect(rollCall).toContainText("Alice");
    await expect(rollCall).toContainText(LINE);
    await expect(page.locator("article.answer-card.has-sticker img.answer-sticker[src='/stickers/frog.svg']")).toBeVisible();
    const card = page.getByRole("region", { name: copy.signatures.cardTitle });
    await expect(card.getByRole("img", { name: signedBy("Alice") })).toBeVisible();
    await expectAccessible(page, `round ${scheme}`);
  }
  // On a wide screen the sticker is slapped on the answer's corner.
  const sticker = page.locator("img.answer-sticker").first();
  expect(await sticker.evaluate((el) => getComputedStyle(el).position)).toBe("absolute");

  // By person: the line as a bubble under Alice's name and her signature closing her answers.
  await page.goto(`/i/${open.issueId}?m=${bob.token}&sort=member`);
  const hers = page.getByRole("region", { name: "Alice", exact: true });
  await expect(hers.locator(".status-bubble")).toHaveText(`${copy.issue.currently} ${LINE}`);
  await expect(hers.locator(".signature-sign-off").getByRole("img", { name: signedBy("Alice") })).toBeVisible();
  // Under reduced motion the ink is simply there, never waiting to draw.
  await expect(hers.locator(".signature-sign-off svg")).toHaveAttribute("data-ink", "still");
});

test("N9 · on a phone the sticker sits beside the name, and the signature writes itself in once", async ({ browser }) => {
  const { loop, delivered, alice } = await seedWorld();
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await rows("update replies set sticker = 'peach' where membership_id = $1", [alice.id]);
  await rows("update memberships set signature = '[[100,100,200,60,300,120,400,80]]' where id = $1", [alice.id]);
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true, reducedMotion: "no-preference" });
  const page = await context.newPage();
  await page.goto(`/i/${delivered.issueId}?m=${bob.token}&sort=member`);
  const sticker = page.locator("img.answer-sticker").first();
  await expect(sticker).toBeVisible();
  expect(await sticker.evaluate((el) => getComputedStyle(el).position)).toBe("static");
  // Below the fold it waits, blank, and draws once it comes into view.
  const ink = page.locator(".signature-sign-off svg");
  await expect(ink).toHaveAttribute("data-ink", /waiting|drawing/);
  await ink.scrollIntoViewIfNeeded();
  await expect(ink).toHaveAttribute("data-ink", "drawing");
  await context.close();
});

test("N9 · a signed-in member signs on the people page and can take it away again", async ({ page }) => {
  const { loop } = await seedWorld();
  const owner = loop.members.find((member) => member.email.startsWith("owner"))!;
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/members`);
  expect((await signatureOf(owner.id)).kind).toBeNull();
  await page.getByText(copy.identity.look.open).click();
  await drawSignature(page);
  // Clear starts over; nothing is saved until it's used.
  await page.getByRole("button", { name: signature.clear }).click();
  await expect(page.getByRole("button", { name: signature.use })).toHaveCount(0);
  expect((await signatureOf(owner.id)).kind).toBeNull();
  await drawSignature(page);
  await page.getByRole("button", { name: signature.use }).click();
  await expect(page.getByText(signature.saved)).toBeVisible();
  const { url } = await signatureOf(owner.id);
  expect(url).toBeTruthy();

  await page.getByRole("button", { name: signature.remove }).click();
  await expect(page.getByText(signature.removed)).toBeVisible();
  expect(await signatureOf(owner.id)).toEqual({ kind: null, url: null });
  expect((await page.request.get(url!)).status()).toBe(404);
});

test("N9 · the routes take only strokes, our own stickers and lines, and only from their own person", async ({ request }) => {
  const { loop, open, alice } = await seedWorld();
  const reader = loop.members.find((member) => member.email.startsWith("bob"))!;
  await rows("update memberships set participation = 'reader' where id = $1", [reader.id]);
  const [question] = await rows<{ id: string }>("select id from issue_questions where issue_id = $1 order by position limit 1", [open.issueId]);
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  const sign = (strokes: string, token = alice.token) =>
    request.post(`/api/reply/${token}/signature`, { multipart: { strokes, photo: { name: "s.png", mimeType: "image/png", buffer: png } } });

  expect((await sign("<svg onload=alert(1)>")).status()).toBe(400);
  expect((await sign("[[1,2,3]]")).status()).toBe(400);
  expect((await sign("[[10,10,50,50]]", "not-a-real-token")).status()).toBe(403);
  expect((await sign("[[10,10,50,50]]")).status()).toBe(200);

  const post = (data: unknown, token = alice.token) => request.post(`/api/reply/${token}`, { data });
  expect((await post({ action: "sticker", issueQuestionId: question.id, sticker: "../../etc" })).status()).toBe(400);
  expect((await post({ action: "sticker", sticker: "frog" })).status()).toBe(400);
  expect((await post({ action: "sticker", issueQuestionId: question.id, sticker: "frog" }, reader.token)).status()).toBe(403);
  expect((await post({ action: "line", body: "x" }, reader.token)).status()).toBe(403);
  expect((await post({ action: "line", body: "  a\nline  " })).status()).toBe(200);
  expect((await rows<{ body: string }>("select body from issue_status_lines where membership_id = $1", [alice.id]))[0].body).toBe("a line");
});

test("N9 · a round nobody signed, lined or stuck anything on reads exactly as before", async ({ page }) => {
  const { loop, delivered } = await seedWorld();
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await page.goto(`/i/${delivered.issueId}?m=${bob.token}`);
  await expect(page.locator("article.answer-card").first()).toBeVisible();
  await expect(page.locator(".roll-call, .signed-card, .answer-sticker, .has-sticker, .status-bubble, .signature-sign-off")).toHaveCount(0);
});
