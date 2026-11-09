import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyParts, excerpt, isUuid, markMentions, mentionIds, plainBody } from "./mentions.ts";
import { activeMention, insertMention, matchMentionables, MENTION_RESULTS } from "./mention-picker.ts";
import { copy } from "./copy.ts";

const MAYA = "11111111-1111-4111-8111-111111111111";
const SAM = "22222222-2222-4222-8222-222222222222";
const SAM_TOO = "33333333-3333-4333-8333-333333333333";

test("typed names become stored markers, and only the ones still in the text", () => {
  const marked = markMentions("Thanks @Maya, and @Sam!", [
    { id: MAYA, label: "Maya" },
    { id: SAM, label: "Sam" },
  ]);
  assert.equal(marked.body, `Thanks @[${MAYA}], and @[${SAM}]!`);
  assert.deepEqual(marked.ids, [MAYA, SAM]);

  const edited = markMentions("Thanks @Maya.", [{ id: MAYA, label: "Maya" }, { id: SAM, label: "Sam" }]);
  assert.deepEqual(edited.ids, [MAYA]);
  assert.equal(edited.body, `Thanks @[${MAYA}].`);
});

test("a name that is only the start of a longer word is not a mention", () => {
  assert.deepEqual(markMentions("hi @Mayakovsky", [{ id: MAYA, label: "Maya" }]).ids, []);
  assert.deepEqual(markMentions("hi @Maya's", [{ id: MAYA, label: "Maya" }]).ids, [MAYA]);
});

test("two people with the same name are two mentions, in order", () => {
  const marked = markMentions("@Sam and @Sam", [{ id: SAM, label: "Sam" }, { id: SAM_TOO, label: "Sam" }]);
  assert.equal(marked.body, `@[${SAM}] and @[${SAM_TOO}]`);
  assert.deepEqual(marked.ids, [SAM, SAM_TOO]);
  assert.deepEqual(markMentions("@Sam @Sam", [{ id: SAM, label: "Sam" }, { id: SAM, label: "Sam" }]).ids, [SAM]);
});

test("labels with regex characters are matched literally", () => {
  assert.deepEqual(markMentions("hey @J.R. (really)", [{ id: MAYA, label: "J.R." }]).ids, [MAYA]);
  assert.deepEqual(markMentions("hey @JxR", [{ id: MAYA, label: "J.R." }]).ids, []);
});

test("stored bodies read back as parts, ids, and plain text", () => {
  const body = `Hi @[${MAYA}] and @[${SAM.toUpperCase()}]! @[${MAYA}] again`;
  assert.deepEqual(mentionIds(body), [MAYA, SAM]);

  const names = new Map([[MAYA, "Maya"]]);
  assert.deepEqual(bodyParts(body, names, copy.issue.unknownMention), [
    { type: "text", text: "Hi " },
    { type: "mention", id: MAYA, name: "Maya" },
    { type: "text", text: " and " },
    { type: "mention", id: SAM, name: copy.issue.unknownMention },
    { type: "text", text: "! " },
    { type: "mention", id: MAYA, name: "Maya" },
    { type: "text", text: " again" },
  ]);
  assert.equal(plainBody(body, names, copy.issue.unknownMention), `Hi @Maya and @${copy.issue.unknownMention}! @Maya again`);
  assert.deepEqual(bodyParts("plain", names, copy.issue.unknownMention), [{ type: "text", text: "plain" }]);
  assert.deepEqual(bodyParts("", names, copy.issue.unknownMention), []);
});

test("uuid check and excerpts", () => {
  assert.equal(isUuid(MAYA), true);
  assert.equal(isUuid("nope"), false);
  assert.equal(excerpt("  short   one ", 40), "short one");
  assert.equal(excerpt("one two three four five six", 15), "one two three…");
  assert.equal(excerpt("abcdefghijklmnopqrstuvwxyz", 10), "abcdefghij…");
});

test("the picker finds the @word being typed", () => {
  assert.deepEqual(activeMention("hello @ma", 9), { start: 6, query: "ma" });
  assert.deepEqual(activeMention("@", 1), { start: 0, query: "" });
  assert.equal(activeMention("no mention", 10), null);
  assert.equal(activeMention("mail me@maya", 12), null, "an email address is not a mention");
  assert.equal(activeMention("hi @maya and more", 17), null, "a space ends it");
  assert.equal(activeMention(`@${"a".repeat(31)}`, 32), null);
});

test("matching puts prefixes first, then any word, and caps the list", () => {
  const people = [
    { id: "1", name: "Priya Maya" },
    { id: "2", name: "Maya Chen" },
    { id: "3", name: "Bob" },
  ];
  assert.deepEqual(matchMentionables(people, "ma").map((person) => person.id), ["2", "1"]);
  assert.deepEqual(matchMentionables(people, "").map((person) => person.id), ["1", "2", "3"]);
  assert.deepEqual(matchMentionables(people, "zz"), []);
  const many = Array.from({ length: 12 }, (_, index) => ({ id: String(index), name: `Pal ${index}` }));
  assert.equal(matchMentionables(many, "pal").length, MENTION_RESULTS);
});

test("choosing a name replaces the @word and leaves the caret after it", () => {
  assert.deepEqual(insertMention("hi @ma there", 3, 6, "Maya Chen"), {
    value: "hi @Maya Chen there",
    caret: 13,
  });
  assert.deepEqual(insertMention("hi @ma", 3, 6, "Maya"), { value: "hi @Maya ", caret: 9 });
});
