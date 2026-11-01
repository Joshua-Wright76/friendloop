import { test, expect } from "@playwright/test";

/**
 * Read-only probes against a deployed URL.
 *
 *   E2E_BASE_URL=https://friendloop.dev npx playwright test --grep @probe
 *
 * The suite's fixtures, its fake clock, and its captured outbox only exist
 * against a local server, so these are the checks that still mean something in
 * production: the app answers, the cron endpoint is closed to strangers, and an
 * unknown credential is a 404 rather than a stack trace.
 *
 * Nothing here writes. A probe that mutates production is an outage waiting for
 * a scheduled run.
 */
const isDeployed = Boolean(process.env.E2E_BASE_URL);

test.describe("@probe deployed", () => {
  test.skip(!isDeployed, "probes run against a deployed URL; set E2E_BASE_URL to include them");

  test("@probe the site and sign-in page render", async ({ request }) => {
    const home = await request.get("/");
    expect(home.status()).toBe(200);
    expect(await home.text()).toContain("Friendloop");

    const signIn = await request.get("/signin");
    expect(signIn.status()).toBe(200);
    expect(await signIn.text()).toContain("Email me a link");
  });

  test("@probe the cron endpoint refuses an anonymous caller", async ({ request }) => {
    const response = await request.get("/api/cron/sweep");
    expect(response.status()).toBe(401);

    const wrong = await request.get("/api/cron/sweep", {
      headers: { authorization: "Bearer not-the-secret" },
    });
    expect(wrong.status()).toBe(401);
  });

  test("@probe a cron-shaped request does not run the sweep anonymously", async ({ request }) => {
    // A caller who supplies the test header must still be refused before the
    // header is ever consulted.
    const response = await request.get("/api/cron/sweep", {
      headers: { "x-e2e-now": "2020-01-01T00:00:00Z" },
    });
    expect(response.status()).toBe(401);
    expect(await response.text()).not.toContain("opened");
  });

  test("@probe unknown links are honest 404s", async ({ request }) => {
    const share = await request.get("/s/definitely-not-a-share-token");
    expect(share.status()).toBe(404);

    const loop = await request.get("/g/00000000-0000-4000-8000-000000000000");
    expect([307, 404]).toContain(loop.status());
  });

  test("@probe a reply link that is not one explains itself", async ({ request }) => {
    const reply = await request.get("/r/definitely-not-a-reply-token");
    expect(reply.status()).toBe(200);
    expect(await reply.text()).not.toMatch(/Unhandled Runtime Error|Application error/i);
  });
});
