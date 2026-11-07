import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_REACTIONS, isReactionEmoji, tallyReactions } from "./reaction-emoji.ts";

test("one real emoji is a reaction, however it's built", () => {
  for (const emoji of [...DEFAULT_REACTIONS, "🦄", "👍🏽", "👩‍🚀", "👨‍👩‍👧‍👦", "🇯🇵", "🏳️‍🌈", "1️⃣"]) {
    assert.equal(isReactionEmoji(emoji), true, emoji);
  }
});

test("anything else is not", () => {
  for (const value of ["", "a", "lol", "🦄🦄", "🦄 ", "<b>", "❤", "1", "<script>", "🇯", null, undefined, 7, {}, "🦄".repeat(40)]) {
    assert.equal(isReactionEmoji(value), false, String(value));
  }
});

test("everything the picker offers, skin tones included, is something the server will take", () => {
  const { emoji } = JSON.parse(readFileSync("public/emoji-picker.json", "utf8")) as {
    emoji: Array<{ e: string; n: string; g: string; s?: string[] }>;
  };
  assert.ok(emoji.length > 1500);
  for (const entry of emoji) {
    assert.equal(isReactionEmoji(entry.e), true, `${entry.e} ${entry.n}`);
    assert.ok(entry.n && entry.g, entry.e);
    for (const skin of entry.s ?? []) assert.equal(isReactionEmoji(skin), true, `${skin} ${entry.n}`);
  }
});

const row = (emoji: string, membershipId: string, minute: number) => ({
  emoji,
  membershipId,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
});

test("someone who can react always has the three defaults, then the rest, oldest first", () => {
  const tally = tallyReactions([row("🦄", "bob", 5), row("🐸", "me", 2), row("❤️", "bob", 9), row("🐸", "bob", 7)], "me");
  assert.deepEqual(tally, [
    { emoji: "❤️", count: 1, mine: false },
    { emoji: "😄", count: 0, mine: false },
    { emoji: "👏", count: 0, mine: false },
    { emoji: "🐸", count: 2, mine: true },
    { emoji: "🦄", count: 1, mine: false },
  ]);
});

test("a stranger sees only what's been used", () => {
  assert.deepEqual(tallyReactions([], null), []);
  assert.deepEqual(tallyReactions([row("🦄", "bob", 1), row("👏", "bob", 2)], null), [
    { emoji: "👏", count: 1, mine: false },
    { emoji: "🦄", count: 1, mine: false },
  ]);
});
