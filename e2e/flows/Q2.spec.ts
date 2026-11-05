import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { PQ1, PQ2, seedKeepsake } from "../support/print";

test.beforeEach(async () => {
  await resetDatabase();
});

test("Q2 · the print view is the web round as it is now, late additions marked and removals gone", async ({ page, request }) => {
  const world = await seedKeepsake();
  const printPath = `/i/${world.issueId}?print&m=${world.alice.token}`;
  const [{ id: laughQuestion }] = await rows<{ id: string }>("select id from issue_questions where issue_id = $1 and text = $2", [world.issueId, PQ1]);
  const [{ id: lookingQuestion }] = await rows<{ id: string }>("select id from issue_questions where issue_id = $1 and text = $2", [world.issueId, PQ2]);

  await page.goto(printPath);
  await expect(page.getByText("A goose on the towpath")).toBeVisible();
  // Sam's and Bob's additions to the original ones: marked, in the same words as the web round says it.
  const markedAtStart = await page.getByText("Added late, after the round went out").count();
  expect(markedAtStart).toBe(2);
  await expect(page.locator(".print-answer").filter({ hasText: "the shed finally stood up" })).toContainText("Added late");
  await expect(page.locator(".print-answer").filter({ hasText: "Added a day later." })).toContainText("Added late");
  await expect(page.locator(".print-answer").filter({ hasText: "A goose on the towpath" })).not.toContainText("Added late");

  // After delivery Alice edits an answer and adds one she never wrote, the way the reply sheet does.
  for (const [issueQuestionId, body] of [[laughQuestion, "A goose, and then a swan"], [lookingQuestion, "Seeing everyone in June"]] as const) {
    const draft = await request.post(`/api/reply/${world.alice.token}`, { data: { action: "draft", issueQuestionId, body } });
    expect(draft.status()).toBe(200);
  }
  expect((await request.post(`/api/reply/${world.alice.token}`, { data: { action: "submit" } })).status()).toBe(200);

  // And an owner takes a comment down.
  await rows("update comments set deleted_at = now() where body = 'Agreed!'");

  await page.goto(printPath);
  // The current text, not the delivered text; a late answer shows up, flagged.
  await expect(page.getByText("A goose, and then a swan")).toBeVisible();
  await expect(page.getByText("A goose on the towpath")).toHaveCount(0);
  const late = page.locator(".print-answer").filter({ hasText: "Seeing everyone in June" });
  await expect(late).toContainText("Alice");
  await expect(late).toContainText("Added late, after the round went out");
  await expect(page.locator(".print-answer").filter({ hasText: "A goose, and then a swan" })).toContainText("Added late");
  // Two replies and two section answers: submitting after delivery also flags the submitter's
  // existing section answer (the web round does the same, and the print view agrees with it).
  await expect(page.getByText("Added late, after the round went out")).toHaveCount(5);
  await expect(page.getByText("Agreed!")).toHaveCount(0);
  await expect(page.getByText("What a round!")).toBeVisible();

  // The web round says exactly as many things were added late.
  await page.goto(`/i/${world.issueId}?m=${world.alice.token}`);
  await expect(page.getByText("added after the issue went out", { exact: true })).toHaveCount(5);

  // Commenting off hides threads on paper exactly as on the web; the words stay stored.
  await rows("update groups set comments_enabled = false where id = $1", [world.loop.groupId]);
  await page.goto(printPath);
  await expect(page.getByText("What a round!")).toHaveCount(0);
  await expect(page.getByText("Best goose ever")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "Comments" })).toHaveCount(0);
  await expect(page.getByText("A goose, and then a swan")).toBeVisible();

  // Renaming the round is picked up too: the print view holds no copy of anything.
  await rows("update issues set name = 'Camping weekend, again' where id = $1", [world.issueId]);
  await page.goto(printPath);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Camping weekend, again");
  await expect(page).toHaveTitle("Camping weekend, again · Friday Loop");
});
