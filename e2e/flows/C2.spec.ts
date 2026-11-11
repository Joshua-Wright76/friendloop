import { test, expect, type Page } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, freezeClock, runSweep, signIn } from "../support/harness";
import { copy, text as copyText } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

const queueList = (page: Page) => page.getByRole("list", { name: copy.questions.upNext.turnsLabel });

function queue(groupId: string) {
  return rows<{ text: string }>("select text from questions where group_id = $1 and frequency = 'rotating' order by position", [groupId])
    .then((result) => result.map((row) => row.text));
}

test("C2 · moving a turn-taker changes the order coming rounds ask them, not this round's", async ({ page }) => {
  const loop = await seedLoop({ questions: ["Q1", "Q2", "Q3", "Q4"] });
  await rows("update groups set questions_per_round = 1 where id = $1", [loop.groupId]);
  await runSweep(AFTER_FIRST_SLOT); // round 1 asks Q1
  await signIn(page, "owner@friendloop.test");
  await freezeClock(page, AFTER_FIRST_SLOT);
  await page.goto(`/g/${loop.groupId}/questions`);

  const rowsOf = queueList(page).locator(":scope > li");
  await expect(rowsOf.first()).toContainText("Q2");
  await expect(rowsOf.first()).toContainText(copyText(copy.questions.upNext.roundTag, { number: "2", date: "Fri 16 Jan" }));

  // A tap on the grip opens Up and Down on that row.
  await page.getByRole("button", { name: copyText(copy.reorder.gripLabel, { item: "Q2" }) }).click();
  // A saved move refreshes the page's data; a list re-rendered under a keyboard drag drops it.
  const refreshed = page.waitForResponse((response) => response.request().headers()["rsc"] === "1" && response.url().includes("/questions"));
  await page.getByRole("button", { name: copyText(copy.reorder.downLabel, { item: "Q2" }) }).click();
  await expect(rowsOf.first()).toContainText("Q3");
  await expect.poll(() => queue(loop.groupId)).toEqual(["Q3", "Q2", "Q4", "Q1"]);
  // Focus stays on the control that moved, and the rounds shown follow the new order.
  await expect(page.getByRole("button", { name: copyText(copy.reorder.downLabel, { item: "Q2" }) })).toBeFocused();
  await expect(rowsOf.nth(1)).toContainText(copyText(copy.questions.upNext.roundTag, { number: "3", date: "Fri 23 Jan" }));

  // The keyboard picks a row up with Space, carries it, and sets it down. Each step is announced.
  const spoken = (words: string) => expect(page.locator('[id^="DndLiveRegion"]').filter({ hasText: words })).toHaveCount(1);
  // The list holds still while the last move saves and the page catches up with it.
  await expect(queueList(page).locator("[data-locked]")).toHaveCount(0);
  await refreshed;
  // A second tap folds Up and Down away again, so the keyboard starts from a settled list.
  const q2Grip = page.getByRole("button", { name: copyText(copy.reorder.gripLabel, { item: "Q2" }) });
  await q2Grip.click();
  await expect(q2Grip).toHaveAttribute("aria-expanded", "false");
  const grip = page.getByRole("button", { name: copyText(copy.reorder.gripLabel, { item: "Q4" }) });
  await grip.focus();
  // Focus glides the page to clear the grip of the bottom bar. Picked up mid-glide, the
  // rows dnd-kit has just measured keep moving and the carried row drifts on its own.
  await settledScroll(page);
  await page.keyboard.press("Space");
  await spoken("Picked up Q4, at 3 of 4.");
  await page.keyboard.press("ArrowUp");
  await spoken("Q4 is at 2 of 4.");
  await page.keyboard.press("ArrowUp");
  await spoken("Q4 is at 1 of 4.");
  await page.keyboard.press("Space");
  await expect.poll(() => queue(loop.groupId)).toEqual(["Q4", "Q3", "Q2", "Q1"]);
  await expect(rowsOf.first()).toContainText("Q4");

  // This round keeps its own order.
  const asked = await rows<{ text: string }>("select text from issue_questions order by position");
  expect(asked.map((row) => row.text)).toEqual(["Q1"]);
});

test("C2 · every-round items reorder among themselves", async ({ page }) => {
  const loop = await seedLoop({ questions: [] });
  for (const [index, title] of ["Wall", "Music", "Notes"].entries()) {
    await rows("insert into questions (group_id, text, frequency, format, active, position) values ($1, $2, 'every_round', 'written', true, $3)", [loop.groupId, title, index]);
  }
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await page.getByRole("button", { name: copyText(copy.reorder.gripLabel, { item: "Notes" }) }).click();
  await page.getByRole("button", { name: copyText(copy.reorder.upLabel, { item: "Notes" }) }).click();
  await expect.poll(async () => (await rows<{ text: string }>("select text from questions where group_id = $1 order by position", [loop.groupId])).map((row) => row.text))
    .toEqual(["Wall", "Notes", "Music"]);
});

test("C2 · dragging a card by its grip moves the whole card, by mouse and by touch", async ({ page, browserName }) => {
  const loop = await seedLoop({ questions: ["Q1", "Q2", "Q3", "Q4"] });
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  const cards = queueList(page).locator(":scope > li");
  await expect(cards).toHaveCount(4);
  // The whole list on screen, so the pointer can reach both ends of the move.
  await queueList(page).evaluate((list) => list.scrollIntoView({ block: "center", behavior: "instant" }));

  // The grip sits on the card's left edge, before its number and words, and is a full-size target.
  const grip = cards.nth(3).locator("button").first();
  await expect(grip).toHaveAccessibleName(copyText(copy.reorder.gripLabel, { item: "Q4" }));
  const [gripBox, cardBox] = [await grip.boundingBox(), await cards.nth(3).boundingBox()];
  expect(gripBox!.x - cardBox!.x).toBeLessThan(4);
  expect(gripBox!.width).toBeGreaterThanOrEqual(44);
  expect(gripBox!.height).toBeGreaterThanOrEqual(44);

  // Mouse: the whole card lifts and follows; the others make room; the drop saves.
  const from = { x: gripBox!.x + gripBox!.width / 2, y: gripBox!.y + gripBox!.height / 2 };
  const to = (await cards.nth(0).boundingBox())!;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, to.y + 8, { steps: 12 });
  await expect(cards.nth(3)).toHaveAttribute("data-dragging", "");
  expect(await cards.nth(3).evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42)).toBeLessThan(-50);
  // The others glide aside rather than jump, so give them the moment it takes.
  await expect.poll(() => cards.nth(0).evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42)).toBeGreaterThan(20);
  await page.mouse.up();
  await expect.poll(() => queue(loop.groupId)).toEqual(["Q4", "Q1", "Q2", "Q3"]);
  await expect(queueList(page).locator("[data-locked]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: copyText(copy.reorder.upLabel, { item: "Q4" }) })).toHaveCount(0); // a drag doesn't open Up and Down

  // Touch, as on a phone: the finger on the grip carries the card, without scrolling the page.
  // Only Chromium takes raw touch moves from a test (through its DevTools protocol).
  if (browserName !== "chromium") return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const touchGrip = (await cards.nth(3).locator("button").first().boundingBox())!;
  const top = (await cards.nth(1).boundingBox())!;
  const x = touchGrip.x + touchGrip.width / 2;
  const y = touchGrip.y + touchGrip.height / 2;
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", atY: number) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y: atY }] });
  await touch("touchStart", y);
  for (let step = 1; step <= 12; step += 1) await touch("touchMove", y + ((top.y + 8 - y) * step) / 12);
  await expect(cards.nth(3)).toHaveAttribute("data-dragging", "");
  await touch("touchEnd", top.y + 8);
  await expect.poll(() => queue(loop.groupId)).toEqual(["Q4", "Q3", "Q1", "Q2"]);
});

/** Resolves once the page has held its scroll position for a few frames. */
async function settledScroll(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    let last = scrollY;
    let still = 0;
    const tick = () => {
      still = scrollY === last ? still + 1 : 0;
      last = scrollY;
      if (still >= 6) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}
