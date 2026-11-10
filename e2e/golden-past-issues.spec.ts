import { test, expect } from "./support/test";
import { resetDatabase } from "./support/db";
import { freezeClock } from "./support/harness";
import { GOLDEN, matchGolden, migrateLikeTheDeploy, seedGoldenWorld } from "./support/golden";

/*
 * Past issues stay exact (docs/questions-unify-design.md): the golden round's page,
 * share page and print views, as text, against `test/golden/`. The data behind them
 * (and the Album, exports and emails) is snapshotted by
 * `test/lib/golden-past-issues.integration.test.ts`. Each page is read twice:
 * with the seed copied by `0023`'s mirror triggers as it went in, and seeded as
 * PR A's release left it, then migrated by the real `0023`.
 */

test.use({ timezoneId: "UTC", locale: "en-US" });

const { issueId, shareToken } = GOLDEN;
const { sam, bob } = GOLDEN.members;
const PAGES: Array<[name: string, path: string]> = [
  ["page-member.txt", `/i/${issueId}?m=${bob.token}`],
  ["page-owner.txt", `/i/${issueId}?m=${sam.token}`],
  ["page-share.txt", `/s/${shareToken}`],
  ["print-member.txt", `/i/${issueId}?print&m=${bob.token}`],
  ["print-share.txt", `/s/${shareToken}?print`],
];

for (const [label, copied] of [["copied by the mirror triggers", false], ["migrated by 0023", true]] as const) {
  test(`golden past issue, ${label}: the page, share page and print views read the same`, async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "one rendering is enough");
    await resetDatabase();
    await seedGoldenWorld();
    if (copied) await migrateLikeTheDeploy();
    await freezeClock(page, GOLDEN.readAt);

    for (const [name, path] of PAGES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const text = await page.locator("main").innerText();
      const result = matchGolden(name, `${text}\n`, { compareOnly: copied });
      if (!result.ok) expect(result.actual, `test/golden/${name} changed (${path})`).toBe(result.expected);
    }
  });
}
