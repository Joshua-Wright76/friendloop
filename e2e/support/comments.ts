import { rows } from "./db";
import { seedDeliveredIssue, seedLoop, type SeededLoop } from "./seed";

/** A delivered round with two answers on it and the people to talk about them. */
export async function seedConversation(input: { readers?: string[] } = {}) {
  const loop: SeededLoop = await seedLoop();
  for (const email of input.readers ?? []) {
    await rows("update memberships set participation = 'reader' where email = $1", [email]);
  }
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [
      { email: "alice@friendloop.test", body: "Alice found a very patient goose." },
      { email: "bob@friendloop.test", body: "Bob rebuilt the shed." },
    ],
  });
  const person = (prefix: string) => loop.members.find((member) => member.email.startsWith(prefix))!;
  return { loop, issue, alice: person("alice"), bob: person("bob"), sam: person("owner") };
}

/** A 1×1 PNG: real bytes, so the server's own signature check has something to accept. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
