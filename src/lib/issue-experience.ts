export const QUESTION_KINDS = ["standard", "photo", "music", "shoutout", "recommendation"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const ISSUE_THEMES = ["picnic", "spring", "summer", "autumn", "winter", "birthday"] as const;
export type IssueTheme = (typeof ISSUE_THEMES)[number];

export const MOOD_EMOJIS = ["😊", "🥳", "😌", "🤩", "😴", "😢"] as const;
export type MoodEmoji = (typeof MOOD_EMOJIS)[number];

export function isQuestionKind(value: unknown): value is QuestionKind {
  return typeof value === "string" && (QUESTION_KINDS as readonly string[]).includes(value);
}

export function normalizeQuestionKind(value: unknown): QuestionKind {
  return isQuestionKind(value) ? value : "standard";
}

export function isIssueTheme(value: unknown): value is IssueTheme {
  return typeof value === "string" && (ISSUE_THEMES as readonly string[]).includes(value);
}

export function normalizeIssueTheme(value: unknown, fallback: IssueTheme = "picnic"): IssueTheme {
  return isIssueTheme(value) ? value : fallback;
}

/** An issue without an override follows the loop's current default stationery. */
export function resolveIssueTheme(issueTheme: unknown, groupTheme: unknown): IssueTheme {
  return isIssueTheme(issueTheme) ? issueTheme : normalizeIssueTheme(groupTheme);
}

export function isMoodEmoji(value: unknown): value is MoodEmoji {
  return typeof value === "string" && (MOOD_EMOJIS as readonly string[]).includes(value);
}

export type MemberColor = {
  background: string;
  foreground: string;
};

/**
 * Stable, high-contrast avatar colors. The id, not array position or name, is
 * the input so someone's color follows them between questions and rounds.
 */
export const MEMBER_COLORS: readonly MemberColor[] = [
  { background: "#8f2d4c", foreground: "#ffffff" },
  { background: "#28613c", foreground: "#ffffff" },
  { background: "#285f85", foreground: "#ffffff" },
  { background: "#67478e", foreground: "#ffffff" },
  { background: "#765414", foreground: "#ffffff" },
  { background: "#97452f", foreground: "#ffffff" },
  { background: "#256563", foreground: "#ffffff" },
  { background: "#465787", foreground: "#ffffff" },
];

export function memberColor(membershipId: string): MemberColor {
  let hash = 2166136261;
  for (let index = 0; index < membershipId.length; index += 1) {
    hash = Math.imul(hash ^ membershipId.charCodeAt(index), 16777619);
  }
  return MEMBER_COLORS[(hash >>> 0) % MEMBER_COLORS.length];
}

/** Every answer tied for the highest non-zero reaction total is most-loved. */
export function mostLovedReplyIds(
  answers: Array<Pick<IssueCurationsAnswer, "replyId" | "reactionCount">>,
): string[] {
  const highest = Math.max(0, ...answers.map((answer) => answer.reactionCount));
  if (highest === 0) return [];
  return answers.filter((answer) => answer.reactionCount === highest).map((answer) => answer.replyId);
}

export type IssueCurationsAnswer = {
  replyId: string;
  reactionCount: number;
  editorPick: boolean;
  mostLoved: boolean;
};

/**
 * Postcards have limited room. Keep manual choices first, reserve one slot for
 * the automatic favorite, then fill remaining space without duplicating replies.
 */
export function postcardPicks<T extends Pick<IssueCurationsAnswer, "replyId" | "editorPick" | "mostLoved">>(
  answers: T[],
  limit = 3,
): T[] {
  if (limit <= 0) return [];
  const manual = answers.filter((answer) => answer.editorPick);
  const automatic = answers.filter((answer) => answer.mostLoved && !answer.editorPick);
  const result: T[] = [];
  const add = (answer: T | undefined) => {
    if (answer && result.length < limit && !result.some((item) => item.replyId === answer.replyId)) {
      result.push(answer);
    }
  };

  const manualSlots = automatic.length > 0 && limit > 1 ? limit - 1 : limit;
  manual.slice(0, manualSlots).forEach(add);
  add(automatic[0]);
  [...manual, ...automatic].forEach(add);
  return result;
}

export function postcardFilename(groupName: string, roundNumber: number): string {
  const slug = groupName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `friendloop-${slug || "loop"}-round-${roundNumber}.png`;
}
