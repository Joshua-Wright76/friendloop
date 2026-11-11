import { test, expect } from "./support/test";
import { copy } from "@/lib/copy";

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
    expect(await signIn.text()).toContain(copy.signIn.submit);
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

  test("@probe unknown links are honest about it", async ({ request }) => {
    // Streamed pages can send their 200 before the lookup misses (the same
    // reason e2e/flows/P3.spec.ts reads the screen rather than the status), so
    // the proof is the not-found screen with no stack trace in the bytes.
    const share = await request.get("/s/definitely-not-a-share-token");
    expect([200, 404]).toContain(share.status());
    const shareBody = await share.text();
    expect(shareBody).toContain(copy.common.notFound.title);
    expect(shareBody).not.toMatch(/Unhandled Runtime Error|Application error/i);

    const loop = await request.get("/g/00000000-0000-4000-8000-000000000000");
    expect([200, 307, 404]).toContain(loop.status());
    if (loop.status() === 200) {
      // Either the not-found screen or, if the route learns to redirect, sign-in:
      // both are honest, and neither carries another loop's data.
      const loopBody = await loop.text();
      expect(loopBody).not.toMatch(/Unhandled Runtime Error|Application error/i);
      expect(loopBody.includes(copy.common.notFound.title) || loopBody.includes(copy.signIn.submit)).toBe(true);
    }
  });

  test("@probe a reply link that is not one explains itself", async ({ request }) => {
    const reply = await request.get("/r/definitely-not-a-reply-token");
    expect(reply.status()).toBe(200);
    expect(await reply.text()).not.toMatch(/Unhandled Runtime Error|Application error/i);
  });
});
