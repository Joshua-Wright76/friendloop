import { expect, type Locator, type Page } from "./test";
import { copy } from "@/lib/copy";

/** One person's row on the People page, found by the name it shows (an unnamed person shows the start of their address). */
export function personRow(page: Page, name: string): Locator {
  const exact = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return page.locator(".ppl-row").filter({ has: page.locator(".ppl-name").filter({ hasText: exact }) });
}

/** Open a person's row, to reach their role, address and the rest of what the owner can do. */
export async function openPerson(page: Page, name: string): Promise<Locator> {
  const row = personRow(page, name);
  const summary = row.locator("button.ppl-summary");
  if ((await summary.getAttribute("aria-expanded")) !== "true") await summary.click();
  await expect(summary).toHaveAttribute("aria-expanded", "true");
  return row;
}

/** On a phone both ways to invite sit behind one button; a wide screen shows them open. */
export async function openInvite(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: copy.members.inviteButton });
  if ((await toggle.count()) > 0 && (await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
}
