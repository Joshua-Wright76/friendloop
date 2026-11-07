import { expect, test } from "@playwright/test";
import { resetDatabase, rows } from "./support/db";
import { hashToken } from "../src/lib/tokens";
import { APP, E2E_NOW, clockHeaders } from "./support/harness";

/**
 * The picker's bottom sheet on a real phone (WebKit, touch). The new-loop form once
 * wrapped each picker in a <label>, so on iOS every tap inside the sheet was handed
 * on to the trigger and the sheet reopened the instant it closed: no way out.
 */
test.skip(({ isMobile }) => !isMobile, "the sheet only exists on a phone");

test.beforeEach(async () => {
  await resetDatabase();
});

test("the day sheet on the new-loop form closes on a choice, on Close, and on the scrim", async ({ context, page }) => {
  test.setTimeout(60_000);
  // A seeded session, not the email round trip: WebKit races the sign-in cookie.
  const token = "picker-phone-session";
  const [user] = await rows<{ id: string }>(`insert into users (email, name) values ('owner@friendloop.test', 'Owner') returning id`);
  await rows(`insert into sessions (user_id, token_hash, expires_at) values ($1, $2, $3)`, [user.id, hashToken(token), new Date(E2E_NOW.getTime() + 86_400_000).toISOString()]);
  await context.addCookies([{ name: "fl_session", value: token, url: new URL(APP).origin }]);
  await page.setExtraHTTPHeaders(clockHeaders(E2E_NOW));
  await page.goto("/g/new");

  const trigger = page.getByRole("button", { name: /^Day:/ });
  const sheet = page.getByRole("dialog", { name: "Day" });

  await trigger.tap();
  await expect(sheet).toBeVisible();
  await sheet.getByRole("option", { name: "Wednesday", exact: true }).tap();
  await expect(sheet).toBeHidden();
  await expect(trigger).toHaveAccessibleName("Day: Wednesday");

  await trigger.tap();
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).tap();
  await expect(sheet).toBeHidden();

  await trigger.tap();
  await expect(sheet).toBeVisible();
  await page.locator(".picker-scrim").tap({ position: { x: 20, y: 20 } });
  await expect(sheet).toBeHidden();
  await expect(trigger).toHaveAccessibleName("Day: Wednesday");
});
