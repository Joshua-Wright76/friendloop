import { expect, test } from "./support/test";
import { resetDatabase } from "./support/db";
import { signIn, uniqueEmail } from "./support/harness";
import { copy } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("prefetching sign-in and new-loop routes does not call connection() in a private cache", async ({ page }) => {
  const connectionErrors: string[] = [];
  const prefetchedRoutes = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.searchParams.has("_rsc")) prefetchedRoutes.add(url.pathname);
  });
  page.on("pageerror", (error) => {
    if (/connection\(\)/i.test(error.message)) connectionErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && /connection\(\)/i.test(message.text())) {
      connectionErrors.push(message.text());
    }
  });

  // Signed out, the landing page offers Sign in; signed in, it offers Your loops instead.
  await page.goto("/");
  const signInLink = page.getByRole("link", { name: copy.signIn.title, exact: true });
  await signInLink.hover();
  await expect.poll(() => prefetchedRoutes.has("/signin")).toBe(true);

  await signIn(page, uniqueEmail("prefetch"));
  await page.goto("/");
  await expect(page.getByRole("link", { name: copy.signIn.title, exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: copy.you.title, exact: true }).hover();
  await expect.poll(() => prefetchedRoutes.has("/you")).toBe(true);

  await page.goto("/you");
  await page.getByRole("link", { name: /new loop/i }).hover();
  await expect.poll(() => prefetchedRoutes.has("/g/new")).toBe(true);

  expect(connectionErrors).toEqual([]);
});
