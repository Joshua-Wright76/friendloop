/*
 * Past issues stay exact (docs/questions-unify-design.md).
 *
 * Seeds one round with every shape a past round can have and snapshots what each
 * reader gets from it: the round as a member, as the owner and by share link, the
 * Album both ways, both exports, and the delivery emails a round like it sends.
 * Merging sections into questions must pass this unchanged. The page and print
 * renderings of the same round are snapshotted by `e2e/golden-past-issues.spec.ts`.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { issues } from "@/db/schema";
import { loadIssue, type IssueView } from "../../src/lib/issue-view.ts";
import { loadAlbum } from "../../src/lib/album.ts";
import { loopArchive, replyLinkExport } from "../../src/lib/data-export.ts";
import { deliverRound } from "../../src/lib/rounds.ts";
import { rows, setupDatabase } from "../support/app.ts";
import { GOLDEN, matchGolden, migrateLikeTheDeploy, reopenGoldenRound, seedGoldenWorld } from "../../e2e/support/golden.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

beforeEach(async () => {
  clearRequest();
  setRequestHeaders({ "x-e2e-now": GOLDEN.readAt.toISOString() });
  await seedGoldenWorld();
});

/** The second reading of each check must agree with the first, never rewrite it. */
let compareOnly = false;

function assertGolden(name: string, value: unknown) {
  const result = matchGolden(name, value, { compareOnly });
  if (!result.ok) assert.equal(result.actual, result.expected, `test/golden/${name} changed`);
}

/** What a reader sees, without the raw loop and issue rows (their columns are the schema's business). */
function readable(view: IssueView | null) {
  assert.ok(view, "the golden round loads");
  const { issue, group, ...rest } = view;
  return { issue: { id: issue.id, number: issue.number, name: issue.name, status: issue.status }, group: group.name, ...rest };
}

async function collect(chunks: AsyncGenerator<string>): Promise<unknown> {
  let out = "";
  for await (const chunk of chunks) out += chunk;
  return JSON.parse(out);
}

/*
 * Each check runs twice, and the second reading must agree with the first: once
 * with the seed copied into the unified tables by `0023`'s mirror triggers as it
 * went in, and once seeded as PR A's release left it and then migrated by the
 * real `0023`, the way the deploy runs it.
 */
for (const [label, copied] of [["copied by the mirror triggers", false], ["migrated by 0023", true]] as const) {
  test(`${label}: a past round reads the same to a member, the owner and a share link`, async () => {
    compareOnly = copied;
    if (copied) await migrateLikeTheDeploy();
    const { sam, bob } = GOLDEN.members;
    assertGolden("issue-member.json", readable(await loadIssue({ issueId: GOLDEN.issueId, viewerMembershipId: bob.id, viewerIsAdmin: false })));
    assertGolden("issue-owner.json", readable(await loadIssue({ issueId: GOLDEN.issueId, viewerMembershipId: sam.id, viewerIsAdmin: true })));
    assertGolden("issue-share.json", readable(await loadIssue({ shareToken: GOLDEN.shareToken })));
  });

  test(`${label}: a past round's photos and voice notes fill the Album the same way`, async () => {
    compareOnly = copied;
    if (copied) await migrateLikeTheDeploy();
    const { sam, bob } = GOLDEN.members;
    const filters = { member: null, q: "", pages: 1 };
    assertGolden("album-member.json", await loadAlbum({ groupId: GOLDEN.groupId, viewerMembershipId: bob.id, viewerIsAdmin: false, filters }));
    assertGolden("album-owner.json", await loadAlbum({ groupId: GOLDEN.groupId, viewerMembershipId: sam.id, viewerIsAdmin: true, filters }));
  });

  test(`${label}: a past round exports the same, for one person and for the whole loop`, async () => {
    compareOnly = copied;
    if (copied) await migrateLikeTheDeploy();
    const person = await replyLinkExport(GOLDEN.members.alice.token, GOLDEN.readAt);
    assert.ok(person);
    assertGolden("export-person.json", await collect(person.chunks));
    const loop = await loopArchive(GOLDEN.groupId, GOLDEN.readAt);
    assert.ok(loop);
    assertGolden("export-loop.json", await collect(loop.chunks));
  });

  test(`${label}: a round like it goes out in the same delivery emails`, async () => {
    compareOnly = copied;
    await reopenGoldenRound();
    if (copied) await migrateLikeTheDeploy();
    const [row] = await db.select().from(issues).where(eq(issues.id, GOLDEN.issueId));
    assert.equal(await deliverRound({ issue: row, at: new Date(GOLDEN.deliveredAt.getTime() + 5 * 60_000) }), "delivered");

    const mail = await rows<{ to: string; subject: string; html: string; text: string }>(
      "select \"to\", subject, html, text from outbox where kind = 'delivery' and \"to\" = any($1) order by \"to\"",
      [[GOLDEN.members.bob.email, GOLDEN.members.cleo.email]],
    );
    assert.equal(mail.length, 2);
    for (const message of mail) {
      const who = message.to.split("@")[0];
      assertGolden(`delivery-${who}.txt`, `Subject: ${message.subject}\n\n${message.text}\n`);
      assertGolden(`delivery-${who}.html`, `${message.html}\n`);
    }
  });
}
