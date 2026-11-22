import { seedDeliveredIssue, seedLoop, seedOpenIssue, seedReplies } from "./seed";
import { seedCardAnswer, seedSectionCard } from "./sections";

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
  const section = await seedSectionCard(first.issueId, { title: "Small wins", emoji: "🏆" });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await seedCardAnswer(section, alice.id, { body: "Alice fixed the gate." });
  const open = await seedOpenIssue(loop, { openedAt: new Date("2026-01-23T08:00:00Z") });
  await seedReplies({
    issueId: open.issueId,
    membershipId: alice.id,
    answers: [{ text: "What made you laugh this week?", body: "Open round answer." }],
  });
  return { loop, first, second, open, alice, bob };
}
