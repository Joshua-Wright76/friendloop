/** `?print` is a switch, not a value: `?print`, `?print=1` and `?print=yes` all ask for the same thing. */
export function wantsPrint(value: string | string[] | undefined): boolean {
  return value !== undefined;
}

/** The print view of a round: the same address with `?print`, carrying the reader's token if they came by one. */
export function printHref(base: string, token?: string | null): string {
  return token ? `${base}?print&m=${encodeURIComponent(token)}` : `${base}?print`;
}

/** The way back from the print view, without `?print`. */
export function webHref(base: string, token?: string | null): string {
  return token ? `${base}?m=${encodeURIComponent(token)}` : base;
}

/** Reactions worth printing: ones somebody actually gave, as "❤️ 2". */
export function reactionSummary(reactions: Array<{ emoji: string; count: number }>): string {
  return reactions
    .filter((reaction) => reaction.count > 0)
    .map((reaction) => `${reaction.emoji} ${reaction.count}`)
    .join("  ");
}
