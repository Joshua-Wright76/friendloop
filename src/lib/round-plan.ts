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
