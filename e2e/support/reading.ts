import { rows } from "./db";
import { seedDeliveredIssue, seedLoop, seedOpenIssue, seedReplies } from "./seed";

/**
 * A loop with two delivered rounds — Alice and Bob answered the first, Bob alone
 * the second — a section Alice wrote in, and an open round Alice has answered.
 */
export async function seedReading() {
  const loop = await seedLoop();
  const first = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-01-09T08:00:00Z"),
    answers: [
      { email: "alice@friendloop.test", body: "Alice on the goose.", questionIndex: 0 },
      { email: "bob@friendloop.test", body: "Bob on the goose.", questionIndex: 0 },
      { email: "alice@friendloop.test", body: "Alice looks forward to soup.", questionIndex: 1 },
      { email: "bob@friendloop.test", body: "Bob looks forward to a nap.", questionIndex: 1 },
    ],
  });
  const second = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-01-16T08:00:00Z"),
    answers: [{ email: "bob@friendloop.test", body: "Bob alone in round two." }],
  });
  const [section] = await rows<{ id: string }>(
    `insert into issue_sections (issue_id, kind, title, emoji, position) values ($1, 'standard', 'Small wins', '🏆', 0) returning id`,
    [first.issueId],
  );
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await rows(
    `insert into section_replies (issue_id, issue_section_id, membership_id, body, status, submitted_at)
     values ($1, $2, $3, 'Alice fixed the gate.', 'submitted', now())`,
    [first.issueId, section.id, alice.id],
  );
  const open = await seedOpenIssue(loop, { openedAt: new Date("2026-01-23T08:00:00Z") });
  await seedReplies({
    issueId: open.issueId,
    membershipId: alice.id,
    answers: [{ text: "What made you laugh this week?", body: "Open round answer." }],
  });
  return { loop, first, second, open, alice, bob };
}
