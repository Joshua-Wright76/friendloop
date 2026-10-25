export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Use the preferred ids for known items, then append any new items in fresh order. */
export function itemsInPreferredOrder<T extends { id: string }>(
  preferredIds: readonly string[],
  fresh: readonly T[],
): T[] {
  const freshById = new Map(fresh.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const merged: T[] = [];

  for (const id of preferredIds) {
    const updated = freshById.get(id);
    if (updated) {
      merged.push(updated);
      seen.add(id);
    }
  }

  for (const item of fresh) {
    if (!seen.has(item.id)) merged.push(item);
  }

  return merged;
}

export function reorderIds(ids: readonly string[], movingId: string, targetIndex: number): string[] {
  const sourceIndex = ids.indexOf(movingId);
  if (sourceIndex < 0 || !Number.isFinite(targetIndex) || ids.length === 0) return [...ids];
  const destination = Math.max(0, Math.min(Math.trunc(targetIndex), ids.length - 1));
  return moveItem(ids, sourceIndex, destination);
}
