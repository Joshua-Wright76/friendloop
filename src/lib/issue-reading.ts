import type { IssueAnswer, IssueBlock, IssueSectionBlock, IssueSectionReplyBlock } from "./issue-view.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Two ways to read a delivered round: by question (as written) or by person. */
export type ReadingSort = "question" | "member";

export type Reading = {
  /** A membership id: only this person's answers. Null means everyone. */
  by: string | null;
  sort: ReadingSort;
};

export type ReadingPerson = { id: string; name: string; photoUrl: string | null; charm: string | null; frame: string | null };

export type PersonEntry =
  | { kind: "answer"; question: string; answer: IssueAnswer }
  | { kind: "section"; title: string; emoji: string | null; reply: IssueSectionReplyBlock };

export type PersonGroup = ReadingPerson & { entries: PersonEntry[] };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Whatever arrived in the URL, made safe: a bad value is the same as the default way of reading. */
export function parseReading(params: { by?: string | string[]; sort?: string | string[] }): Reading {
  const by = first(params.by).trim();
  return {
    by: UUID.test(by) ? by.toLowerCase() : null,
    sort: first(params.sort) === "member" ? "member" : "question",
  };
}

/** Everyone who wrote something in the round, by name, each listed once. */
export function readingPeople(input: { blocks: IssueBlock[]; sections: IssueSectionBlock[] }): ReadingPerson[] {
  const people = new Map<string, ReadingPerson>();
  const note = (entry: { authorId: string; authorName: string; authorPhotoUrl: string | null; authorCharm: string | null; authorFrame: string | null }) => {
    if (!people.has(entry.authorId)) {
      people.set(entry.authorId, { id: entry.authorId, name: entry.authorName, photoUrl: entry.authorPhotoUrl, charm: entry.authorCharm, frame: entry.authorFrame });
    }
  };
  for (const block of input.blocks) block.answers.forEach(note);
  for (const section of input.sections) section.replies.forEach(note);
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Where this round lives with this way of reading it, carrying the reader's token if they came by one. */
export function readingHref(base: string, token: string | null, reading: Reading): string {
  const query = new URLSearchParams();
  if (token) query.set("m", token);
  if (reading.by) query.set("by", reading.by);
  if (reading.sort === "member") query.set("sort", "member");
  const string = query.toString();
  return string ? `${base}?${string}` : base;
}

export type ReadingResult = {
  blocks: IssueBlock[];
  sections: IssueSectionBlock[];
  /** Set when reading by person: one group per author, in name order. */
  groups: PersonGroup[] | null;
  /** The one person being read, when `by` named someone who wrote in this round. */
  focus: ReadingPerson | null;
};

/**
 * Narrow and arrange a round's answers. This only chooses what to show: tallies,
 * threads and reactions travel with the answers untouched, and the print view and
 * the share link never pass through here.
 */
export function applyReading(
  input: { blocks: IssueBlock[]; sections: IssueSectionBlock[] },
  reading: Reading,
): ReadingResult {
  const people = readingPeople(input);
  const focus = people.find((person) => person.id === reading.by) ?? null;
  const plain = !focus && reading.sort === "question";
  if (plain) return { blocks: input.blocks, sections: input.sections, groups: null, focus: null };

  const blocks = focus
    ? input.blocks
        .map((block) => ({ ...block, answers: block.answers.filter((answer) => answer.authorId === focus.id) }))
        .filter((block) => block.answers.length > 0)
    : input.blocks;
  const sections = focus
    ? input.sections
        .map((section) => ({ ...section, replies: section.replies.filter((reply) => reply.authorId === focus.id) }))
        .filter((section) => section.replies.length > 0)
    : input.sections;

  if (reading.sort !== "member") return { blocks, sections, groups: null, focus };

  const groups: PersonGroup[] = (focus ? [focus] : people).map((person) => ({
    ...person,
    entries: [
      ...blocks.flatMap((block) =>
        block.answers
          .filter((answer) => answer.authorId === person.id)
          .map((answer): PersonEntry => ({ kind: "answer", question: block.question, answer })),
      ),
      ...sections.flatMap((section) =>
        section.replies
          .filter((reply) => reply.authorId === person.id)
          .map((reply): PersonEntry => ({ kind: "section", title: section.title, emoji: section.emoji, reply })),
      ),
    ],
  }));
  return { blocks, sections, groups, focus };
}
