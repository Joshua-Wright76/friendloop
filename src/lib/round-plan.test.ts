import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN_MAX_ROUNDS, firstRounds, planRounds, takeTurns } from "./round-plan.ts";

const queue = ["q1", "q2", "q3", "q4", "q5"];

test("a round takes the head of the queue, as many as it asks", () => {
  assert.deepEqual(takeTurns(queue, 2), ["q1", "q2"]);
  assert.deepEqual(takeTurns(queue, 9), queue, "a count larger than the queue takes all of it");
  assert.deepEqual(takeTurns(queue, 0), []);
  assert.deepEqual(takeTurns(queue, -3), [], "a nonsense count takes nothing");
});

test("no count means every turn-taker, in queue order, as a copy", () => {
  const all = takeTurns(queue, null);
  assert.deepEqual(all, queue);
  assert.notEqual(all, queue);
  assert.deepEqual(takeTurns([], null), []);
});

// A weekly loop going out Fridays at 9:00 in London; 2 Jan 2026 is a Friday.
const schedule = { timezone: "Europe/London", promptWeekday: 5, promptHour: 9, cadenceWeeks: 1, createdAt: new Date("2025-12-01T00:00:00Z") };
const friday = new Date("2026-01-02T09:00:00Z");
const day = (iso: string) => new Date(`${iso}T09:00:00Z`);

test("the plan shows the next round, then rounds until every turn-taker has had its turn", () => {
  const plan = planRounds({ queue, count: 2, dated: [], schedule, opensAt: friday, number: 4 });
  assert.deepEqual(plan.map((round) => round.number), [4, 5, 6]);
  assert.deepEqual(plan.map((round) => round.turns), [["q1", "q2"], ["q3", "q4"], ["q5", "q1"]]);
  assert.deepEqual(plan.map((round) => round.deliversAt), [day("2026-01-09"), day("2026-01-16"), day("2026-01-23")]);
  assert.deepEqual(plan[1].opensAt, day("2026-01-09"), "a round opens as the one before goes out");
});

test("asking every turn-taker each round, or having none, plans one round", () => {
  const all = planRounds({ queue, count: null, dated: [], schedule, opensAt: friday, number: 1 });
  assert.deepEqual(all.map((round) => round.turns), [queue]);
  const none = planRounds({ queue: [], count: 3, dated: [], schedule, opensAt: friday, number: 1 });
  assert.deepEqual(none.map((round) => round.turns), [[]]);
});

test("a long queue stops at six rounds", () => {
  const long = Array.from({ length: 20 }, (_, index) => `q${index}`);
  const plan = planRounds({ queue: long, count: 1, dated: [], schedule, opensAt: friday, number: 1 });
  assert.equal(plan.length, PLAN_MAX_ROUNDS);
  assert.deepEqual(plan.at(-1)?.turns, ["q5"]);
});

test("each round catches the dated items in its days, once, minus days taken out", () => {
  const dated = [
    { id: "party", rule: { kind: "once" as const, month: 1, day: 14, year: 2026 }, skippedDates: [] },
    { id: "maya", rule: { kind: "birthday" as const, month: 1, day: 9, year: null }, skippedDates: [] },
    { id: "sam", rule: { kind: "birthday" as const, month: 1, day: 5, year: null }, skippedDates: [] },
    { id: "skipped", rule: { kind: "birthday" as const, month: 1, day: 6, year: null }, skippedDates: ["2026-01-06"] },
    { id: "lee", rule: { kind: "birthday" as const, month: 1, day: 12, year: null }, skippedDates: [] },
  ];
  const plan = planRounds({ queue, count: 2, dated, schedule, opensAt: friday, number: 1, claimed: [{ id: "sam", date: "2026-01-05" }] });
  assert.deepEqual(plan[0].dated, [{ id: "maya", date: "2026-01-09" }], "the open round already holds Sam's; the 6th was taken out");
  assert.deepEqual(plan[1].dated, [{ id: "lee", date: "2026-01-12" }, { id: "party", date: "2026-01-14" }], "Maya's day ends one round and opens the next: caught once; the rest by date");

  const first = firstRounds(plan);
  assert.equal(first.get("q5")?.round.number, 3);
  assert.equal(first.get("q1")?.round.number, 1, "an item's first turn, not its second");
  assert.deepEqual(first.get("party"), { round: plan[1], date: "2026-01-14" });
  assert.equal(first.has("sam"), false);
});
