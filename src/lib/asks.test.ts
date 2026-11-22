import { test } from "node:test";
import assert from "node:assert/strict";
import { askedOf, askLabel, isSectionLike } from "./asks.ts";
import { copy } from "./copy.ts";

test("copied sections, photo walls and music picks lay out like sections", () => {
  assert.equal(isSectionLike({ fromSection: true, format: "written" }), true);
  assert.equal(isSectionLike({ fromSection: false, format: "photo_wall" }), true);
  assert.equal(isSectionLike({ fromSection: false, format: "music" }), true);
  assert.equal(isSectionLike({ fromSection: false, format: "written" }), false);
  assert.equal(isSectionLike({ fromSection: false, format: "poll" }), false);
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
  assert.equal(askLabel({ text: copy.questions.item.formats.photo_wall, emoji: "📸" }), `📸 ${copy.questions.item.formats.photo_wall}`);
  assert.equal(askLabel({ text: "What made you laugh?", emoji: null }), "What made you laugh?");
  assert.equal(askLabel({ text: "Blank emoji", emoji: "" }), "Blank emoji");
});
