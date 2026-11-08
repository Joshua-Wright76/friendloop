/**
 * Where a signed-in member answers their own loop: their own reply link, the same
 * one their prompt email carries. Only someone who answers in this loop gets one,
 * and only while a round is taking answers (a paused loop holds its round).
 *
 * The token is a credential, so callers pass only the viewer's own membership,
 * and the result reaches nobody but that viewer.
 */
export function ownAnswerHref(input: {
  participation: "contributor" | "reader";
  replyToken: string;
  pausedAt: Date | null;
  hasOpenRound: boolean;
}): string | null {
  if (input.participation !== "contributor") return null;
  if (input.pausedAt || !input.hasOpenRound) return null;
  return `/r/${encodeURIComponent(input.replyToken)}`;
}
