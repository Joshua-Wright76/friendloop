import { test } from "node:test";
import assert from "node:assert/strict";
import { draftIsWorthKeeping, mergeDraft, type LoopDraft } from "./draft.ts";

const fresh: LoopDraft = {
  step: 0,
  name: "",
  cadence: "1",
  weekday: "5",
  hour: "9",
  timezone: "",
  picked: ["First?", "Second?"],
  customQuestions: [],
  pickedIdeas: [],
  emails: [],
  participation: "contributor",
  personalNote: "",
  preset: "gingham",
  accent: "",
  looks: { background: "plain", paperPack: "classic", tapePack: "washi", mascot: "cherry" },
  hasPicture: false,
};

test("an untouched wizard isn't worth keeping, even once the zone fills in", () => {
  assert.equal(draftIsWorthKeeping(fresh, fresh), false);
  assert.equal(draftIsWorthKeeping({ ...fresh, timezone: "Europe/London" }, fresh), false);
});

test("a name, a later step, or a picture is worth keeping", () => {
  assert.equal(draftIsWorthKeeping({ ...fresh, name: "Book Club" }, fresh), true);
  assert.equal(draftIsWorthKeeping({ ...fresh, step: 2 }, fresh), true);
  assert.equal(draftIsWorthKeeping({ ...fresh, hasPicture: true }, fresh), true);
  assert.equal(draftIsWorthKeeping({ ...fresh, looks: { ...fresh.looks, mascot: "fox" } }, fresh), true);
});

test("a kept draft comes back whole", () => {
  const kept = { ...fresh, step: 3, name: "Kitchen Table", emails: ["ruth@example.com"], participation: "reader" as const };
  assert.deepEqual(mergeDraft(fresh, JSON.parse(JSON.stringify(kept))), kept);
});

test("anything odd in a kept draft falls back to the fresh value", () => {
  const merged = mergeDraft(fresh, {
    step: "3",
    name: 42,
    picked: ["ok", 7],
    emails: "ruth@example.com",
    participation: "admin",
    looks: { background: 1, mascot: "fox" },
  });
  assert.equal(merged.step, 0);
  assert.equal(merged.name, "");
  assert.deepEqual(merged.picked, fresh.picked);
  assert.deepEqual(merged.emails, []);
  assert.equal(merged.participation, "contributor");
  assert.deepEqual(merged.looks, { ...fresh.looks, mascot: "fox" });
});
