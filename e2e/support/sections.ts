import { rows } from "./db";

/*
 * Sections and dates as the one list of questions holds them
 * (docs/questions-unify-design.md). The legacy section tables are gone; these
 * write what migration `0023` made of them, and what the Questions page makes now.
 */

type Kind = "standard" | "photo_wall" | "music";
const formatOf = (kind: Kind) => (kind === "standard" ? "written" : kind);

/** A pool item asked every round: what a section became. Returns its id. */
export async function seedEveryRoundItem(
  groupId: string,
  input: { kind?: Kind; title: string; emoji?: string | null; adminOnly?: boolean; position?: number },
): Promise<string> {
  const [row] = await rows<{ id: string }>(
    `insert into questions (group_id, text, position, format, frequency, emoji, admin_only)
     values ($1, $2, $3, $4, 'every_round', $5, $6) returning id`,
    [groupId, input.title, 1000 + (input.position ?? 0), formatOf(input.kind ?? "standard"), input.emoji ?? null, input.adminOnly ?? false],
  );
  return row.id;
}

/** A date to celebrate, as an item asked on a date: what an event became. Returns its id. */
export async function seedDateItem(
  groupId: string,
  input: { kind: "once" | "birthday"; title?: string | null; emoji?: string | null; month: number; day: number; year?: number | null; membershipId?: string | null },
): Promise<string> {
  const [row] = await rows<{ id: string }>(
    `insert into questions (group_id, text, position, format, frequency, emoji, date_kind, month, day, year, about_membership_id)
     values ($1, $2, 0, 'written', 'on_date', $3, $4, $5, $6, $7, $8) returning id`,
    [groupId, input.title ?? "", input.emoji ?? null, input.kind, input.month, input.day, input.year ?? null, input.membershipId ?? null],
  );
  return row.id;
}

/**
 * A round's card from before sections were questions, as `0023` copied it: marked
 * `from_section` so it keeps a section's look, after the round's questions in
 * section order. Returns its id.
 */
export async function seedSectionCard(
  issueId: string,
  input: {
    kind?: Kind;
    title: string;
    emoji?: string | null;
    description?: string | null;
    adminOnly?: boolean;
    position?: number;
    questionId?: string | null;
    occurrenceDate?: string | null;
    aboutMembershipId?: string | null;
  },
): Promise<string> {
  const [row] = await rows<{ id: string }>(
    `insert into issue_questions (issue_id, question_id, text, position, format, emoji, description, admin_only,
                                  occurrence_date, about_membership_id, from_section)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true) returning id`,
    [
      issueId,
      input.questionId ?? null,
      input.title,
      1000 + (input.position ?? 0),
      formatOf(input.kind ?? "standard"),
      input.emoji ?? null,
      input.description ?? null,
      input.adminOnly ?? false,
      input.occurrenceDate ?? null,
      input.aboutMembershipId ?? null,
    ],
  );
  return row.id;
}

/** The id of a round's card by its title. */
export async function cardId(issueId: string, title: string): Promise<string> {
  const [row] = await rows<{ id: string }>("select id from issue_questions where issue_id = $1 and text = $2", [issueId, title]);
  if (!row) throw new Error(`No card "${title}" in round ${issueId}`);
  return row.id;
}

/**
 * Someone's answer to a card, with its photos as `reply_media` (a photo wall's, and
 * a section's one photo in a round already out). Returns the answer's id.
 */
export async function seedCardAnswer(
  issueQuestionId: string,
  membershipId: string,
  input: {
    body?: string;
    link?: { url: string; provider: string };
    media?: Array<{ url: string; caption: string | null }>;
    late?: boolean;
    neverSent?: boolean;
  } = {},
): Promise<string> {
  const [row] = await rows<{ id: string }>(
    `insert into replies (issue_id, issue_question_id, membership_id, body, link_url, link_provider, added_after_delivery, never_sent)
     select issue_id, id, $2, $3, $4, $5, $6, $7 from issue_questions where id = $1 returning id`,
    [issueQuestionId, membershipId, input.body ?? "", input.link?.url ?? null, input.link?.provider ?? null, input.late ?? false, input.neverSent ?? false],
  );
  if (!row) throw new Error(`No card ${issueQuestionId}`);
  for (const [position, item] of (input.media ?? []).entries()) {
    await rows("insert into reply_media (reply_id, url, caption, position) values ($1, $2, $3, $4)", [row.id, item.url, item.caption, position]);
  }
  return row.id;
}
