export type RoundQuestion = { id: string; skipNext: boolean };

export function selectRoundQuestions<T extends RoundQuestion>(
  pool: T[],
  count: number | null,
  cursor: number,
): { selected: T[]; nextCursor: number } {
  const eligible = pool.filter((question) => !question.skipNext);
  if (count === null || pool.length <= count) {
    return { selected: eligible, nextCursor: 0 };
  }

  const start = ((cursor % pool.length) + pool.length) % pool.length;
  const rotated = [...pool.slice(start), ...pool.slice(0, start)];
  const selected = rotated.filter((question) => !question.skipNext).slice(0, count);
  const last = selected.at(-1);
  if (!last) return { selected, nextCursor: 0 };

  const lastIndex = pool.findIndex((question) => question.id === last.id);
  return { selected, nextCursor: (lastIndex + 1) % pool.length };
}
