import { test as base } from "@playwright/test";

export { expect, type Download, type Locator, type Page } from "@playwright/test";

/**
 * Every spec's `test`, with a `page.goto` that leaves the page ready to use.
 *
 * - Safari reports a page's own `history.replaceState` (Next.js does one as it
 *   settles after each navigation) as a navigation, and a `goto` started just
 *   before it lands is "interrupted" by the page it was leaving. That is a quirk
 *   of driving WebKit, not something a person can do, so the `goto` is made again.
 * - Words typed into the server's HTML before React takes the page over are lost
 *   when it does. A test types within milliseconds of the page arriving, which in
 *   Safari is often before then, so it waits until React owns the page's controls.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = async (url, options) => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          const response = await goto(url, options);
          // A loop page streams in behind its loading state (React marks a boundary still
          // on its way with a <template id="B:…">), and each part hydrates on its own, so
          // it waits for the stream to finish and then for every control. Ten seconds at
          // most: a control React never owns (one inside injected HTML) mustn't hold it up.
          await page.waitForFunction(() => {
            if (document.querySelector('template[id^="B:"]')) return false;
            const controls = document.querySelectorAll("#main-content :is(textarea, input:not([type=hidden]), select, button)");
            return [...controls].every((control) => Object.keys(control).some((key) => key.startsWith("__reactFiber")));
          }, undefined, { timeout: 10_000, polling: 100 }).catch(() => undefined);
          return response;
        } catch (error) {
          if (attempt === 3 || !(error instanceof Error) || !error.message.includes("is interrupted by another navigation")) throw error;
        }
      }
    };
    await use(page);
  },
});
