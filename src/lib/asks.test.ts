import { test } from "node:test";
import assert from "node:assert/strict";
import { askedOf, askLabel, formatOf, isSectionLike, legacyActive } from "./asks.ts";

test("a row's format is its own, or its kind when it predates the column", () => {
  assert.equal(formatOf({ format: "music", kind: "written" }), "music");
  assert.equal(formatOf({ format: null, kind: "poll" }), "poll");
  assert.equal(formatOf({ format: null, kind: "written" }), "written");
});

test("copied sections, photo walls and music picks lay out like sections", () => {
  assert.equal(isSectionLike({ fromSection: true, format: "written", kind: "written" }), true);
  assert.equal(isSectionLike({ fromSection: false, format: "photo_wall", kind: "written" }), true);
  assert.equal(isSectionLike({ fromSection: false, format: "music", kind: "written" }), true);
  assert.equal(isSectionLike({ fromSection: false, format: "written", kind: "written" }), false);
  assert.equal(isSectionLike({ fromSection: false, format: null, kind: "poll" }), false);
});

test("owners-only items skip plain members, and a birthday card skips its subject", () => {
  const member = { id: "m", access: "member" as const };
  const admin = { id: "a", access: "admin" as const };
  const owner = { id: "o", access: "owner" as const };
  const plain = { adminOnly: false, aboutMembershipId: null };
  const ownersOnly = { adminOnly: true, aboutMembershipId: null };
  assert.equal(askedOf(plain, member), true);
  assert.equal(askedOf(ownersOnly, member), false);
  assert.equal(askedOf(ownersOnly, admin), true);
  assert.equal(askedOf(ownersOnly, owner), true);
  assert.equal(askedOf({ adminOnly: false, aboutMembershipId: "m" }, member), false);
  assert.equal(askedOf({ adminOnly: false, aboutMembershipId: "m" }, admin), true);
  assert.equal(askedOf({ adminOnly: true, aboutMembershipId: "a" }, admin), false);
});

test("an item is named by its emoji and words", () => {
  assert.equal(askLabel({ text: "Photo wall", emoji: "📸" }), "📸 Photo wall");
  assert.equal(askLabel({ text: "What made you laugh?", emoji: null }), "What made you laugh?");
  assert.equal(askLabel({ text: "Blank emoji", emoji: "" }), "Blank emoji");
});

test("only written and poll questions asked as questions stay visible to the code before the switch", () => {
  assert.equal(legacyActive({ format: "written", frequency: "rotating" }), true);
  assert.equal(legacyActive({ format: "poll", frequency: "every_round" }), true);
  assert.equal(legacyActive({ format: "photo_wall", frequency: "rotating" }), false);
  assert.equal(legacyActive({ format: "music", frequency: "every_round" }), false);
  assert.equal(legacyActive({ format: "written", frequency: "on_date" }), false);
});
