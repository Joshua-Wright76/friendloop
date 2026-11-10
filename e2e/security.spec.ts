import { expect, test, type Page } from "./support/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { resetDatabase, rows } from "./support/db";
import { seedDeliveredIssue, seedLoop, seedOpenIssue } from "./support/seed";
import { seedAlbum } from "./support/album";
import { freezeClock, signIn } from "./support/harness";
import { copy } from "@/lib/copy";

/*
 * The headers are static (next.config.ts), so these assertions hold for every
 * render path. The violation walk is the real test of the policy: it visits the
 * main flows — public, signed in, reply link, delivered round, share link,
 * print view, album, preview tools — and fails on any blocked load or script.
 */

type Violation = { directive: string; blocked: string; url: string };

/** Collect every CSP violation from every document the page loads. */
async function watchCsp(page: Page): Promise<string[]> {
  const found: string[] = [];
  await page.exposeBinding("__reportCsp", (_source, violation: Violation) => {
    found.push(`${violation.url}: ${violation.directive} blocked ${violation.blocked}`);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __reportCsp: (v: Violation) => void }).__reportCsp({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        url: location.pathname,
      });
    });
  });
  page.on("console", (message) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(message.text())) found.push(`console: ${message.text()}`);
  });
  return found;
}

async function visit(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBeLessThan(400);
  // Let lazy images, audio metadata, and hydration finish loading.
  await page.waitForLoadState("networkidle");
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("every route sends the security headers; credential routes send no referrer", async ({ request }) => {
  const landing = await request.get("/");
  const headers = landing.headers();
  const csp = headers["content-security-policy"];
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("microphone=(self)");
  expect(headers["permissions-policy"]).toContain("camera=()");

  for (const path of ["/r/not-a-token", "/r/not-a-token/leave", "/u/not-a-token", "/s/not-a-token", "/signin", "/you", "/you/delete", "/album/not-an-id", "/join/not-a-token"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()["referrer-policy"], path).toBe("no-referrer");
    expect(response.headers()["content-security-policy"], path).toContain("frame-ancestors 'none'");
  }

  // Static assets and route handlers carry them too.
  const robots = await request.get("/robots.txt");
  expect(robots.headers()["x-content-type-options"]).toBe("nosniff");
});

test("the main flows load without a single CSP violation", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const violations = await watchCsp(page);

  const { loop, alice, round2 } = await seedAlbum();
  await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-01-20T08:00:00Z"),
    answers: [{ email: alice.email, body: "Shared with the world." }],
    shareToken: "csp-share-token",
  });
  await db.update(groups).set({ shareEnabled: true }).where(eq(groups.id, loop.groupId));
  // Inside round 3's answering window, so Alice's reply sheet is open.
  await freezeClock(page, new Date("2026-01-24T08:00:00Z"));

  for (const path of ["/", "/signin", "/r/not-a-token", "/privacy", "/terms", "/goodbye"]) await visit(page, path);

  // A reply link: the sheet hydrates, autosaves through fetch, and is allowed
  // the microphone for voice notes.
  await visit(page, `/r/${alice.token}`);
  const field = page.locator("textarea").first();
  await field.fill("Checking the policy");
  await page.waitForResponse((response) => response.url().includes("/api/reply/") && response.request().method() === "POST");
  if (browserName === "chromium") {
    const allowed = await page.evaluate(() => {
      const policy = (document as unknown as { featurePolicy?: { allowsFeature(name: string): boolean } }).featurePolicy;
      return policy ? { microphone: policy.allowsFeature("microphone"), camera: policy.allowsFeature("camera") } : null;
    });
    if (allowed) expect(allowed).toEqual({ microphone: true, camera: false });
  }

  // A delivered round with photos and voice notes, its print view, the share
  // link, and the album for inbox readers.
  await visit(page, `/i/${round2}?m=${alice.token}`);
  await visit(page, `/i/${round2}?m=${alice.token}&print`);
  await visit(page, "/s/csp-share-token");
  await visit(page, `/album/${loop.groupId}?m=${alice.token}`);
  // Leaving through a reply link asks first; nothing is deleted by the visit.
  await visit(page, `/r/${alice.token}/leave`);

  // Signed in: the account page, a new loop, and every loop tab. Back on the
  // real clock first — a session minted in January would expire on arrival.
  await page.setExtraHTTPHeaders({});
  await signIn(page, "owner@friendloop.test");
  for (const path of [
    "/you",
    "/you/delete",
    "/g/new",
    `/g/${loop.groupId}`,
    `/g/${loop.groupId}/members`,
    `/g/${loop.groupId}/questions`,
    `/g/${loop.groupId}/issues`,
    `/g/${loop.groupId}/album`,
    `/g/${loop.groupId}/settings`,
  ]) {
    await visit(page, path);
  }
  // Client-side navigation between tabs (partial prefetch + RSC payloads).
  await page.getByRole("navigation", { name: copy.common.navigation.ariaLabel }).getByRole("link", { name: copy.common.navigation.people }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${loop.groupId}/members$`));
  await page.waitForLoadState("networkidle");

  // The preview tools: the email previews render in sandboxed srcdoc frames.
  await page.goto(`/dev/ui?key=${process.env.UI_PREVIEW_SECRET ?? "e2e-preview-secret"}`);
  await page.waitForURL("**/dev/screens");
  await page.waitForLoadState("networkidle");
  await visit(page, "/dev/emails");

  expect(violations).toEqual([]);
});

test("an open round's reply sheet loads without CSP violations on a phone-width page", async ({ page }) => {
  const violations = await watchCsp(page);
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: new Date("2026-10-23T07:00:00Z") });
  await freezeClock(page, new Date("2026-10-24T08:00:00Z"));
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, `/r/${loop.ownerToken}`);
  expect(violations).toEqual([]);
});

test("the landing page has a link-preview card; private pages preview as Friendloop and are noindex", async ({ page, request }) => {
  await page.goto("/");
  // With a server per worker, the build's own address can sit beside this one: only the path is used below.
  const og = (property: string) => page.locator(`meta[property="${property}"]`).first().getAttribute("content");
  const twitter = (name: string) => page.locator(`meta[name="${name}"]`).getAttribute("content");
  expect(await og("og:title")).toBe("Friendloop");
  expect(await og("og:type")).toBe("website");
  expect(await twitter("twitter:card")).toBe("summary_large_image");
  const image = await og("og:image");
  expect(image).toMatch(/\/opengraph-image/);
  expect(await og("og:image:width")).toBe("1200");
  expect(await page.locator('meta[name="robots"]').count()).toBe(0);

  const png = await request.get(new URL(image!).pathname + new URL(image!).search);
  expect(png.status()).toBe(200);
  expect(png.headers()["content-type"]).toBe("image/png");

  const loop = await seedLoop({ name: "Secret Supper Club" });
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "Nobody should see this in a preview." }],
  });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await rows("insert into invite_links (group_id, token) values ($1, 'preview-join-token')", [loop.groupId]);
  for (const path of ["/join/preview-join-token", `/r/${alice.token}`, `/r/${alice.token}/leave`, `/i/${issue.issueId}?m=${alice.token}`, `/album/${loop.groupId}?m=${alice.token}`, "/signin", "/goodbye"]) {
    await page.goto(path);
    expect(await page.locator('meta[name="robots"]').getAttribute("content"), path).toContain("noindex");
    for (const selector of ['meta[property^="og:"]', 'meta[name^="twitter:"]', 'meta[name="description"]']) {
      for (const content of await page.locator(selector).evaluateAll((tags) => tags.map((tag) => tag.getAttribute("content") ?? ""))) {
        expect(content, `${path} ${selector}`).not.toContain("Secret Supper Club");
        expect(content, `${path} ${selector}`).not.toContain("Nobody should see this");
      }
    }
  }

  // The legal pages are public, indexable, and carry the site's own card.
  for (const path of ["/privacy", "/terms"]) {
    await page.goto(path);
    expect(await page.locator('meta[name="robots"]').count(), path).toBe(0);
    expect(await og("og:title"), path).toBe("Friendloop");
  }

  const robots = await (await request.get("/robots.txt")).text();
  for (const prefix of ["/r/", "/u/", "/s/", "/i/", "/g/", "/album/", "/you", "/signin", "/join/"]) {
    expect(robots).toContain(`Disallow: ${prefix}`);
  }
});

test("the version route answers uncached, with no commit outside Vercel", async ({ request }) => {
  const response = await request.get("/api/version");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({ commit: null });
});
