import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyReading,
  parseReading,
  readingHref,
  readingPeople,
} from "./issue-reading.ts";
import type { IssueAnswer, IssueBlock, IssueSectionBlock, IssueSectionReplyBlock } from "./issue-view.ts";

const MAYA = "11111111-1111-4111-8111-111111111111";
const ALEX = "22222222-2222-4222-8222-222222222222";

function answer(replyId: string, authorId: string, authorName: string): IssueAnswer {
  return {
    replyId,
    authorId,
    authorName,
    author: authorName,
    authorPhotoUrl: null,
    authorCharm: null,
    authorFrame: null,
    isYou: false,
    body: replyId,
    photoUrl: null,
    audioUrl: null,
    audioDurationMs: null,
    choices: [],
    addedLater: false,
    reactions: [],
    comments: [],
  };
}

function sectionReply(replyId: string, authorId: string, authorName: string): IssueSectionReplyBlock {
  return {
    replyId,
    authorId,
    authorName,
    author: authorName,
    authorPhotoUrl: null,
    authorCharm: null,
    authorFrame: null,
    isYou: false,
    body: replyId,
    linkUrl: null,
    linkProvider: null,
    linkTitle: null,
    linkArtwork: null,
    linkTracks: [],
    linkTrackCount: 0,
    addedLater: false,
    media: [],
    reactions: [],
    comments: [],
  };
}

const blocks: IssueBlock[] = [
  {
    questionId: "q1",
    question: "First?",
    suggestedBy: null,
    poll: null,
    answers: [answer("a1", MAYA, "Maya"), answer("a2", ALEX, "Alex")],
  },
  { questionId: "q2", question: "Second?", suggestedBy: null, poll: null, answers: [answer("a3", ALEX, "Alex")] },
];
const sections: IssueSectionBlock[] = [
  {
    id: "s1",
    kind: "standard",
    title: "Photos",
    emoji: "📷",
    description: null,
    replies: [sectionReply("r1", MAYA, "Maya")],
  },
  { id: "s2", kind: "standard", title: "Empty", emoji: null, description: null, replies: [] },
];

test("the URL is parsed into a safe way of reading", () => {
  assert.deepEqual(parseReading({}), { by: null, sort: "question" });
  assert.deepEqual(parseReading({ by: MAYA.toUpperCase(), sort: "member" }), { by: MAYA, sort: "member" });
  assert.deepEqual(parseReading({ by: ["not-an-id"], sort: ["sideways"] }), { by: null, sort: "question" });
  assert.deepEqual(parseReading({ by: [MAYA, ALEX], sort: ["member"] }), { by: MAYA, sort: "member" });
});

test("people are listed once each, by name", () => {
  assert.deepEqual(
    readingPeople({ blocks, sections }).map((person) => person.name),
    ["Alex", "Maya"],
  );
  assert.deepEqual(readingPeople({ blocks: [], sections: [] }), []);
  const twins = readingPeople({
    blocks: [
      { ...blocks[0], answers: [answer("x", ALEX, "Sam"), answer("y", MAYA, "Sam")] },
    ],
    sections: [],
  });
  assert.deepEqual(twins.map((person) => person.id), [MAYA, ALEX], "same name falls back to a stable order");
});

test("reading hrefs carry the token and only the non-default choices", () => {
  assert.equal(readingHref("/i/1", null, { by: null, sort: "question" }), "/i/1");
  assert.equal(readingHref("/i/1", "tok en", { by: null, sort: "question" }), "/i/1?m=tok+en");
  assert.equal(readingHref("/i/1", null, { by: MAYA, sort: "member" }), `/i/1?by=${MAYA}&sort=member`);
});

test("the default way of reading hands the round back untouched", () => {
  const result = applyReading({ blocks, sections }, { by: null, sort: "question" });
  assert.equal(result.blocks, blocks);
  assert.equal(result.sections, sections);
  assert.equal(result.groups, null);
  assert.equal(result.focus, null);
});

test("an unknown person is the same as everyone", () => {
  const result = applyReading({ blocks, sections }, { by: "99999999-9999-4999-8999-999999999999", sort: "question" });
  assert.equal(result.blocks, blocks);
  assert.equal(result.focus, null);
});

test("reading one person keeps only their answers and drops what they skipped", () => {
  const result = applyReading({ blocks, sections }, { by: MAYA, sort: "question" });
  assert.equal(result.focus?.name, "Maya");
  assert.deepEqual(result.blocks.map((block) => block.questionId), ["q1"]);
  assert.deepEqual(result.blocks[0].answers.map((item) => item.replyId), ["a1"]);
  assert.deepEqual(result.sections.map((section) => section.id), ["s1"]);

  const alex = applyReading({ blocks, sections }, { by: ALEX, sort: "question" });
  assert.deepEqual(alex.blocks.map((block) => block.questionId), ["q1", "q2"]);
  assert.deepEqual(alex.sections, [], "someone with no section answer sees no section cards");
});

test("reading by person groups every answer under its author", () => {
  const result = applyReading({ blocks, sections }, { by: null, sort: "member" });
  assert.deepEqual(result.groups?.map((group) => group.name), ["Alex", "Maya"]);
  assert.deepEqual(
    result.groups?.[0].entries.map((entry) => (entry.kind === "answer" ? entry.question : entry.title)),
    ["First?", "Second?"],
  );
  assert.deepEqual(
    result.groups?.[1].entries.map((entry) => (entry.kind === "answer" ? entry.question : entry.title)),
    ["First?", "Photos"],
  );
  assert.equal(result.focus, null);
});

test("reading one person by person is a single group", () => {
  const result = applyReading({ blocks, sections }, { by: MAYA, sort: "member" });
  assert.equal(result.groups?.length, 1);
  assert.equal(result.groups?.[0].id, MAYA);
  assert.equal(result.focus?.id, MAYA);
});
