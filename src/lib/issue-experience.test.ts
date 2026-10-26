import test from "node:test";
import assert from "node:assert/strict";
import {
  ISSUE_THEMES,
  MEMBER_COLORS,
  QUESTION_KINDS,
  isMoodEmoji,
  memberColor,
  mostLovedReplyIds,
  normalizeQuestionKind,
  postcardFilename,
  postcardPicks,
  resolveIssueTheme,
} from "./issue-experience.ts";

test("question kinds and issue themes retain safe defaults", () => {
  assert.deepEqual(QUESTION_KINDS, ["standard", "photo", "music", "shoutout", "recommendation"]);
  assert.deepEqual(ISSUE_THEMES, ["picnic", "spring", "summer", "autumn", "winter", "birthday"]);
  assert.equal(normalizeQuestionKind("music"), "music");
  assert.equal(normalizeQuestionKind("unexpected"), "standard");
  assert.equal(resolveIssueTheme(null, "autumn"), "autumn");
  assert.equal(resolveIssueTheme("winter", "autumn"), "winter");
  assert.equal(resolveIssueTheme("unexpected", "unexpected"), "picnic");
});

test("moods are optional but limited to the accessible choices", () => {
  assert.equal(isMoodEmoji("🥳"), true);
  assert.equal(isMoodEmoji("<script>"), false);
  assert.equal(isMoodEmoji(null), false);
});

test("member colors are deterministic and contrast-safe", () => {
  const id = "22222222-2222-4222-8222-222222222225";
  assert.deepEqual(memberColor(id), memberColor(id));
  assert.deepEqual(memberColor(id), memberColor(`${id}`));
  for (const color of MEMBER_COLORS) {
    assert.ok(contrastRatio(color.background, color.foreground) >= 4.5, JSON.stringify(color));
  }
});

test("most-loved includes ties and never promotes an unreacted answer", () => {
  assert.deepEqual(mostLovedReplyIds([
    { replyId: "a", reactionCount: 2 },
    { replyId: "b", reactionCount: 4 },
    { replyId: "c", reactionCount: 4 },
    { replyId: "d", reactionCount: 1 },
  ]), ["b", "c"]);
  assert.deepEqual(mostLovedReplyIds([{ replyId: "a", reactionCount: 0 }]), []);
  assert.deepEqual(mostLovedReplyIds([]), []);
});

test("postcard curation keeps editor picks and reserves room for most-loved", () => {
  const answers = [
    { replyId: "manual-1", editorPick: true, mostLoved: false },
    { replyId: "manual-2", editorPick: true, mostLoved: false },
    { replyId: "manual-3", editorPick: true, mostLoved: false },
    { replyId: "loved", editorPick: false, mostLoved: true },
  ];
  assert.deepEqual(postcardPicks(answers).map((answer) => answer.replyId), ["manual-1", "manual-2", "loved"]);
  assert.deepEqual(postcardPicks(answers, 2).map((answer) => answer.replyId), ["manual-1", "loved"]);
  assert.equal(new Set(postcardPicks(answers).map((answer) => answer.replyId)).size, 3);
});

test("postcard filenames are stable, safe, and image-only", () => {
  assert.equal(postcardFilename("Saturday Club!", 11), "friendloop-saturday-club-round-11.png");
  assert.equal(postcardFilename("!!!", 2), "friendloop-loop-round-2.png");
});

function contrastRatio(background: string, foreground: string): number {
  const first = luminance(background);
  const second = luminance(foreground);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
