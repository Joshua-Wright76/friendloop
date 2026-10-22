import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { addMember, seedLoop } from "../support/seed";

test.beforeEach(async () => {
  await resetDatabase();
});

test("G4 · a reader posting to the reply endpoint is refused with 403", async ({ request }) => {
  const loop = await seedLoop();
  const reader = await addMember(loop, {
    email: "reader@friendloop.test",
    participation: "reader",
  });

  const response = await request.post(`/api/reply/${reader.token}`, {
    data: { action: "draft", issueQuestionId: "00000000-0000-0000-0000-000000000000", body: "nope" },
  });
  expect(response.status()).toBe(403);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining("Readers") });
});
