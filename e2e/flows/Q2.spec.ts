import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { PQ1, PQ2, seedKeepsake } from "../support/print";
import { copy, text } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("Q2 · the print view is the web round as it is now, old late additions marked and removals gone", async ({ page, request }) => {
  const world = await seedKeepsake();
  const printPath = `/i/${world.issueId}?print&m=${world.alice.token}`;
  const [{ id: laughQuestion }] = await rows<{ id: string }>("select id from issue_questions where issue_id = $1 and text = $2", [world.issueId, PQ1]);
  const [{ id: lookingQuestion }] = await rows<{ id: string }>("select id from issue_questions where issue_id = $1 and text = $2", [world.issueId, PQ2]);

  await page.goto(printPath);
  await expect(page.getByText("A goose on the towpath")).toBeVisible();
  // Sam's and Bob's additions to the original ones: marked, in the same words as the web round says it.
  const markedAtStart = await page.getByText(copy.print.late).count();
  expect(markedAtStart).toBe(2);
  await expect(page.locator(".print-answer").filter({ hasText: "the shed finally stood up" })).toContainText("Added late");
  await expect(page.locator(".print-answer").filter({ hasText: "Added a day later." })).toContainText("Added late");
  await expect(page.locator(".print-answer").filter({ hasText: "A goose on the towpath" })).not.toContainText("Added late");

  // A delivered round takes no more answers through the reply link: it reaches the open round only.
  const refused = await request.post(`/api/reply/${world.alice.token}`, {
    data: { action: "draft", issueQuestionId: laughQuestion, body: "Too late now" },
  });
  expect(refused.status()).toBe(409);

  // Rounds from before that rule kept changing after they went out, and the stored rows say so.
  // Here one answer was rewritten later and one was added later, as the old sheet would have.
  await rows(
    "update replies set body = 'A goose, and then a swan', added_after_delivery = true where issue_id = $1 and issue_question_id = $2 and membership_id = $3",
    [world.issueId, laughQuestion, world.alice.id],
  );
  await rows(
    `insert into replies (issue_id, issue_question_id, membership_id, body, status, submitted_at, added_after_delivery)
     values ($1, $2, $3, 'Seeing everyone in June', 'submitted', now(), true)`,
    [world.issueId, lookingQuestion, world.alice.id],
  );

  // And an owner takes a comment down.
  await rows("update comments set deleted_at = now() where body = 'Agreed!'");

  await page.goto(printPath);
  // The current text, not the delivered text; a late answer shows up, flagged.
  await expect(page.getByText("A goose, and then a swan")).toBeVisible();
  await expect(page.getByText("A goose on the towpath")).toHaveCount(0);
  const late = page.locator(".print-answer").filter({ hasText: "Seeing everyone in June" });
  await expect(late).toContainText("Alice");
  await expect(late).toContainText(copy.print.late);
  await expect(page.locator(".print-answer").filter({ hasText: "A goose, and then a swan" })).toContainText("Added late");
  // The two from the start, plus Alice's two.
  await expect(page.getByText(copy.print.late)).toHaveCount(4);
  await expect(page.getByText("Agreed!")).toHaveCount(0);
  await expect(page.getByText("What a round!")).toBeVisible();

  // The web round says exactly as many things were added late.
  await page.goto(`/i/${world.issueId}?m=${world.alice.token}`);
  await expect(page.getByText(copy.issue.addedLater, { exact: true })).toHaveCount(4);

  // Commenting off hides threads on paper exactly as on the web; the words stay stored.
  await rows("update groups set comments_enabled = false where id = $1", [world.loop.groupId]);
  await page.goto(printPath);
  await expect(page.getByText("What a round!")).toHaveCount(0);
  await expect(page.getByText("Best goose ever")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: copy.print.commentsHeading })).toHaveCount(0);
  await expect(page.getByText("A goose, and then a swan")).toBeVisible();

  // Renaming the round is picked up too: the print view holds no copy of anything.
  await rows("update issues set name = 'Camping weekend, again' where id = $1", [world.issueId]);
  await page.goto(printPath);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Camping weekend, again");
  await expect(page).toHaveTitle(text(copy.print.documentTitle, { title: "Camping weekend, again", loop: "Friday Loop" }));
});
