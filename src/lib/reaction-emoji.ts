/** The three that are always one tap away. Anything else comes from the picker. */
export const DEFAULT_REACTIONS: readonly string[] = ["❤️", "😄", "👏"];

/** Plenty for one person on one answer, and a ceiling for a script. */
export const MAX_REACTIONS_PER_PERSON = 12;

// Built from a string because the `v` flag needs a newer language target than the app compiles to.
const ONE_EMOJI = new RegExp("^\\p{RGI_Emoji}$", "v");

/** Exactly one real emoji, skin tones and families included. Words, markup and pairs of emoji are not reactions. */
export function isReactionEmoji(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && ONE_EMOJI.test(value);
}

export type ReactionRow = { emoji: string; membershipId: string; createdAt: Date };
export type ReactionTally = { emoji: string; count: number; mine: boolean };

/**
 * One answer's chips. Someone who can react always sees the three defaults, then
 * whatever else people reached for, oldest first, so a chip never jumps once it's
 * there. A stranger reading a shared round only sees what's been used.
 */
export function tallyReactions(rows: ReactionRow[], viewerMembershipId: string | null): ReactionTally[] {
  const others = [...rows]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((row) => row.emoji)
    .filter((emoji) => !DEFAULT_REACTIONS.includes(emoji));
  return [...new Set([...DEFAULT_REACTIONS, ...others])]
    .map((emoji) => {
      const forEmoji = rows.filter((row) => row.emoji === emoji);
      return {
        emoji,
        count: forEmoji.length,
        mine: forEmoji.some((row) => row.membershipId === viewerMembershipId),
      };
    })
    .filter((reaction) => reaction.count > 0 || viewerMembershipId !== null);
}
