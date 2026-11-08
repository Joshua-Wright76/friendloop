import { test, expect, type Page } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, freezeClock, runSweep, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

const queueList = (page: Page) => page.getByRole("list", { name: "Questions that take turns, in the order rounds ask them" });

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
  await expect(rowsOf.first()).toContainText("Round 2 · Fri 16 Jan");

  // A tap on the grip opens Up and Down on that row.
  await page.getByRole("button", { name: "Move: Q2" }).click();
  await page.getByRole("button", { name: "Move down: Q2" }).click();
  await expect(rowsOf.first()).toContainText("Q3");
  await expect.poll(() => queue(loop.groupId)).toEqual(["Q3", "Q2", "Q4", "Q1"]);
  // Focus stays on the control that moved, and the rounds shown follow the new order.
  await expect(page.getByRole("button", { name: "Move down: Q2" })).toBeFocused();
  await expect(rowsOf.nth(1)).toContainText("Round 3 · Fri 23 Jan");

  // The keyboard picks a row up with Space, carries it, and sets it down. Each step is announced.
  const spoken = (words: string) => expect(page.locator('[id^="DndLiveRegion"]').filter({ hasText: words })).toHaveCount(1);
  // The list holds still while the last move saves.
  await expect(queueList(page).locator("[data-locked]")).toHaveCount(0);
  const grip = page.getByRole("button", { name: "Move: Q4" });
  await grip.focus();
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
  await page.getByRole("button", { name: "Move: Notes" }).click();
  await page.getByRole("button", { name: "Move up: Notes" }).click();
  await expect.poll(async () => (await rows<{ text: string }>("select text from questions where group_id = $1 order by position", [loop.groupId])).map((row) => row.text))
    .toEqual(["Wall", "Notes", "Music"]);
});

test("C2 · dragging a card by its grip moves the whole card, by mouse and by touch", async ({ page }) => {
  const loop = await seedLoop({ questions: ["Q1", "Q2", "Q3", "Q4"] });
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  const cards = queueList(page).locator(":scope > li");
  await expect(cards).toHaveCount(4);
  // The whole list on screen, so the pointer can reach both ends of the move.
  await queueList(page).evaluate((list) => list.scrollIntoView({ block: "center", behavior: "instant" }));

  // The grip sits on the card's left edge, before its number and words, and is a full-size target.
  const grip = cards.nth(3).locator("button").first();
  await expect(grip).toHaveAccessibleName("Move: Q4");
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
  expect(await cards.nth(0).evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42)).toBeGreaterThan(20);
  await page.mouse.up();
  await expect.poll(() => queue(loop.groupId)).toEqual(["Q4", "Q1", "Q2", "Q3"]);
  await expect(queueList(page).locator("[data-locked]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Move up: Q4" })).toHaveCount(0); // a drag doesn't open Up and Down

  // Touch, as on a phone: the finger on the grip carries the card, without scrolling the page.
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
