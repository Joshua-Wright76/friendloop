import { expect, type Page } from "./test";
import { copy } from "@/lib/copy";

/** The Questions page folds the usual order and the rounds ahead behind "Plan future rounds": open it. */
export async function openPlan(page: Page) {
  const summary = page.locator("details > summary").filter({ has: page.getByRole("heading", { name: copy.questions.plan.summary }) });
  await summary.waitFor();
  const details = summary.locator("xpath=ancestor::details[1]");
  if ((await details.getAttribute("open")) === null) await summary.click();
  await expect(details).toHaveAttribute("open", "");
}

/**
 * Run a check on what the plan holds. A change reloads the page, which folds the plan again,
 * and the page can finish settling just after it was opened: so open it and look, until both hold.
 */
export async function inPlan(page: Page, check: () => Promise<unknown>) {
  await expect(async () => {
    await openPlan(page);
    await check();
  }).toPass({ timeout: 20_000 });
}
