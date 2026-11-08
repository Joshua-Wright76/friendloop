import { issueCoverage, occurrencesInWindow, type EventRule } from "./event-dates.ts";
import { nextSlot, type LoopSchedule } from "./schedule.ts";

/**
 * The queue (docs/questions-unify-design.md, "Rotation and Up next"). Pure: the
 * caller passes the turn-taking items in queue order.
 *
 * A round takes the first `count` items that take turns; null means every one of
 * them. The caller moves what was taken to the back of the queue, so the next
 * round starts where this one stopped and the order on the page is the order
 * they will be asked.
 */
export function takeTurns<T>(queue: T[], count: number | null): T[] {
  if (count === null) return [...queue];
  return queue.slice(0, Math.max(0, count));
}

/** A dated item, as the plan needs it: its rule and the days the owner took out of a round. */
export type PlanDated = { id: string; rule: EventRule; skippedDates: readonly string[] };

export type PlannedRound = {
  number: number;
  opensAt: Date;
  deliversAt: Date;
  /** The turn-takers this round asks, in queue order. */
  turns: string[];
  /** Dated items whose day falls in the round, soonest first. */
  dated: Array<{ id: string; date: string }>;
};

/** However long the queue, Up next looks this many rounds ahead at most. */
export const PLAN_MAX_ROUNDS = 6;

/**
 * Up next: what the coming rounds will ask if nothing changes. The next round in
 * full, then later rounds until every turn-taker has had its turn once (at most
 * six rounds). Each round opens as the one before goes out, as `openRound` does,
 * and catches the dated items in its days. A projection only: a carried-over
 * round or a later edit moves it.
 */
export function planRounds(input: {
  queue: readonly string[];
  count: number | null;
  dated: readonly PlanDated[];
  schedule: LoopSchedule;
  /** When the next round opens: the open round's delivery, or now without one. */
  opensAt: Date;
  /** The next round's number. */
  number: number;
  /** Already asked by the open round: it can't catch them again. */
  claimed?: ReadonlyArray<{ id: string; date: string }>;
}): PlannedRound[] {
  const rounds: PlannedRound[] = [];
  const claimed = new Set((input.claimed ?? []).map((claim) => `${claim.id} ${claim.date}`));
  const unseen = new Set(input.queue);
  let queue = [...input.queue];
  let opensAt = input.opensAt;

  do {
    const deliversAt = nextSlot(input.schedule, opensAt);
    const turns = takeTurns(queue, input.count);
    // Everyone asked each round leaves the queue where it was.
    if (input.count !== null) queue = [...queue.slice(turns.length), ...turns];
    for (const id of turns) unseen.delete(id);

    const window = issueCoverage({ opensAt, deliversAt, timezone: input.schedule.timezone });
    const dated = input.dated
      .flatMap((item) => occurrencesInWindow(item.rule, window)
        .filter((date) => !item.skippedDates.includes(date) && !claimed.has(`${item.id} ${date}`))
        .map((date) => ({ id: item.id, date })))
      .sort((left, right) => left.date.localeCompare(right.date));
    for (const claim of dated) claimed.add(`${claim.id} ${claim.date}`);

    rounds.push({ number: input.number + rounds.length, opensAt, deliversAt, turns, dated });
    opensAt = deliversAt;
  } while (unseen.size > 0 && rounds.length < PLAN_MAX_ROUNDS);

  return rounds;
}

/** Where each item first comes up in a plan: its round, and its date for a dated item. */
export function firstRounds(plan: readonly PlannedRound[]): Map<string, { round: PlannedRound; date: string | null }> {
  const found = new Map<string, { round: PlannedRound; date: string | null }>();
  for (const round of plan) {
    for (const id of round.turns) if (!found.has(id)) found.set(id, { round, date: null });
    for (const { id, date } of round.dated) if (!found.has(id)) found.set(id, { round, date });
  }
  return found;
}
