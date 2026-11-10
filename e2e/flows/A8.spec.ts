import { test, expect, type Page } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { clockHeaders, E2E_NOW, uniqueEmail } from "../support/harness";
import { LIMITS } from "../../src/lib/rate-limit-policy";
import { copy, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

const signInMail = async (to: string) =>
  (await rows<{ count: number }>(
    "select count(*)::int as count from outbox where kind = 'signin' and \"to\" = $1",
    [to],
  ))[0].count;

async function requestLink(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel(copy.signIn.emailLabel).fill(email);
  await page.getByRole("button", { name: copy.signIn.submit }).click();
}

test("A8 · a flooded address still sees 'check your inbox', but no more mail goes out", async ({ page }) => {
  await page.setExtraHTTPHeaders({ ...clockHeaders(E2E_NOW), "x-forwarded-for": "198.51.100.10" });
  const email = uniqueEmail("target");

  for (let i = 0; i < LIMITS.signInEmail.max + 2; i++) {
    await requestLink(page, email);
    await expect(page).toHaveURL(/\/signin\/check-email$/);
    await expect(page.getByRole("heading", { name: copy.checkEmail.title })).toBeVisible();
  }
  expect(await signInMail(email)).toBe(LIMITS.signInEmail.max);
});

test("A8 · a flooding network is told to wait, and nothing is sent", async ({ page }) => {
  const ip = "203.0.113.50";
  // The network has already spent its hour.
  const windowStart = Math.floor(E2E_NOW.getTime() / LIMITS.signInIp.windowMs) * LIMITS.signInIp.windowMs;
  await rows("insert into rate_limits (key, window_start, count, expires_at) values ($1, $2, $3, $4)", [
    `signin:ip:${ip}`,
    new Date(windowStart).toISOString(),
    LIMITS.signInIp.max,
    new Date(windowStart + LIMITS.signInIp.windowMs).toISOString(),
  ]);
  await page.setExtraHTTPHeaders({ ...clockHeaders(E2E_NOW), "x-forwarded-for": ip });
  const email = uniqueEmail("blocked");

  await requestLink(page, email);
  await expect(page.getByText(copyPattern(copy.signIn.tooMany))).toBeVisible();
  await expect(page).toHaveURL(/\/signin$/);
  expect(await signInMail(email)).toBe(0);

  // A different network is unaffected.
  await page.setExtraHTTPHeaders({ ...clockHeaders(E2E_NOW), "x-forwarded-for": "198.51.100.11" });
  await requestLink(page, email);
  await expect(page).toHaveURL(/\/signin\/check-email$/);
  expect(await signInMail(email)).toBe(1);
});

test("A8 · a stranger's feedback flood is refused with 429 and friendly words", async ({ request }) => {
  const headers = { ...clockHeaders(E2E_NOW), "x-forwarded-for": "203.0.113.60" };
  const send = () => request.post("/api/feedback", { headers, data: { message: "Broken!", path: "/", viewport: "1x1" } });
  for (let i = 0; i < LIMITS.feedbackAnonymous.max; i++) expect((await send()).status()).toBe(200);
  const refused = await send();
  expect(refused.status()).toBe(429);
  expect((await refused.json()).error).toMatch(copyPattern(copy.feedback.errors.tooMany))
});
