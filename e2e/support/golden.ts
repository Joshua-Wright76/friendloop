import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rows } from "./db";

/*
 * The golden past issue (docs/questions-unify-design.md, "Past issues stay exact").
 *
 * One delivered round holding every shape a past round can have: written answers
 * with a photo and a voice note, a late answer, a draft the round went out without,
 * an answer cleared back to blank, a poll, a suggestion credit, a question nobody
 * answered, a standard section with a photo, a photo wall, a music pick, an
 * owners-only section, a section nobody answered, a one-time event and a birthday,
 * plus reactions and comments. Everything is written with fixed ids, tokens and
 * times, so what it renders is the same on every run and the snapshots under
 * `test/golden/` can be compared byte for byte.
 *
 * The sections, dates and their answers are written as migration `0023` copied
 * them out of the legacy tables (dropped since): items asked every round or on a
 * date, snapshotted with `from_section`, their answers in `replies` and the photos
 * in `reply_media`, every copy keeping its legacy id. Past rounds must keep reading
 * exactly as they did before sections became questions. If a change is meant to
 * alter how past rounds read, regenerate with `UPDATE_GOLDEN=1` and review the diff.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const GOLDEN = {
  groupId: id(1),
  issueId: id(10),
  shareToken: "golden-share-token",
  deliveredAt: new Date("2026-10-30T08:00:00Z"),
  /** The instant pages and exports are read at: a week after it went out. */
  readAt: new Date("2026-11-06T09:00:00Z"),
  members: {
    sam: { id: id(2), token: "golden-token-sam", email: "sam@golden.test" },
    alice: { id: id(3), token: "golden-token-alice", email: "alice@golden.test" },
    bob: { id: id(4), token: "golden-token-bob", email: "bob@golden.test" },
    cleo: { id: id(5), token: "golden-token-cleo", email: "cleo@golden.test" },
  },
  musicUrl: "https://open.spotify.com/track/golden",
} as const;

const OPENED = "2026-10-23T08:00:00Z";
const DELIVERED = GOLDEN.deliveredAt.toISOString();
const at = (minutes: number) => new Date(Date.parse(OPENED) + minutes * 60_000).toISOString();

/** Seed the golden loop. Returns nothing: every id is in `GOLDEN` or fixed below. */
export async function seedGoldenWorld(): Promise<void> {
  const { sam, alice, bob, cleo } = GOLDEN.members;
  const g = GOLDEN.groupId;
  const issue = GOLDEN.issueId;

  await rows(
    `insert into groups (id, name, display_name, timezone, prompt_weekday, prompt_hour, cadence_weeks, share_enabled, comments_enabled, created_at)
     values ($1, 'Golden Loop', 'Golden Loop', 'Europe/Amsterdam', 5, 9, 1, true, true, '2026-01-01T00:00:00Z')`,
    [g],
  );
  const people: Array<[string, string, string, string, string, string]> = [
    [sam.id, sam.email, "Sam", "owner", sam.token, "a".repeat(64)],
    [alice.id, alice.email, "Alice", "member", alice.token, "b".repeat(64)],
    [bob.id, bob.email, "Bob", "member", bob.token, "c".repeat(64)],
    [cleo.id, cleo.email, "Cleo", "admin", cleo.token, "d".repeat(64)],
  ];
  for (const [index, [memberId, email, name, access, token, unsubscribe]] of people.entries()) {
    await rows(
      `insert into memberships (id, group_id, email, name, access, participation, reply_token, unsubscribe_token, invited_at, accepted_at)
       values ($1, $2, $3, $4, $5, 'contributor', $6, $7, $8, $8)`,
      [memberId, g, email, name, access, token, unsubscribe, new Date(Date.parse("2026-01-01T00:00:00Z") + index * 60_000).toISOString()],
    );
  }

  // The pool, and a suggestion Alice made that the owner accepted.
  await rows(
    `insert into questions (id, group_id, text, position, format, poll_multiple, poll_options, created_by_membership_id, created_at) values
      ($1, $5, 'What made you laugh this week?', 0, 'written', false, null, null, '2026-01-01T00:00:00Z'),
      ($2, $5, 'What are you looking forward to?', 1, 'written', false, null, $6, '2026-01-01T00:00:00Z'),
      ($3, $5, 'Which weekends work?', 2, 'poll', true, '["June","July","August"]', null, '2026-01-01T00:00:00Z'),
      ($4, $5, 'What did you cook?', 3, 'written', false, null, null, '2026-01-01T00:00:00Z')`,
    [id(20), id(21), id(22), id(23), g, alice.id],
  );
  await rows(
    `insert into questions (id, group_id, text, position, format, archived_at, created_at)
     values ($1, $2, 'What did you plant?', 4, 'written', '2026-06-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    [id(25), g],
  );
  await rows(
    `insert into question_suggestions (id, group_id, membership_id, text, author_display, status, accepted_question_id, decided_at, created_at)
     values ($1, $2, $3, 'What are you looking forward to?', 'name', 'accepted', $4, '2026-01-02T00:00:00Z', '2026-01-01T12:00:00Z')`,
    [id(24), g, alice.id, id(21)],
  );

  // Sections, asked every round after the questions, and dates.
  await rows(
    `insert into questions (id, group_id, text, position, format, frequency, emoji, description, admin_only, created_at) values
      ($1, $6, 'This week', 1000, 'written', 'every_round', '📝', 'Anything you want to tell us.', false, '2026-01-01T00:00:00Z'),
      ($2, $6, 'Photo wall', 1001, 'photo_wall', 'every_round', '📸', null, false, '2026-01-01T00:00:00Z'),
      ($3, $6, 'Song of the week', 1002, 'music', 'every_round', '🎵', 'One song, any service.', false, '2026-01-01T00:00:00Z'),
      ($4, $6, 'Planning', 1003, 'written', 'every_round', '🗂️', 'Just for the people running things.', true, '2026-01-01T00:00:00Z'),
      ($5, $6, 'Small wins', 1004, 'written', 'every_round', '🏅', null, false, '2026-01-01T00:00:00Z')`,
    [id(30), id(31), id(32), id(33), id(34), g],
  );
  await rows(
    `insert into questions (id, group_id, text, position, format, frequency, emoji, date_kind, month, day, year, about_membership_id, created_at) values
      ($1, $3, 'Camping weekend', 0, 'written', 'on_date', '🏕️', 'once', 10, 29, 2026, null, '2026-01-01T00:00:00Z'),
      ($2, $3, '', 0, 'written', 'on_date', '🎂', 'birthday', 10, 28, null, $4, '2026-01-01T00:00:00Z')`,
    [id(40), id(41), g, alice.id],
  );

  // The round, delivered, with its share link.
  await rows(
    `insert into issues (id, group_id, number, status, slot_at, opens_at, delivers_at, delivered_at, share_token, created_at)
     values ($1, $2, 1, 'delivered', $3, $4, $3, $3, $5, $4)`,
    [issue, g, DELIVERED, OPENED, GOLDEN.shareToken],
  );
  await rows(
    `insert into issue_questions (id, issue_id, question_id, text, position, suggested_by, format, poll_multiple, poll_options) values
      ($1, $5, $6, 'What made you laugh this week?', 0, null, 'written', false, null),
      ($2, $5, $7, 'What are you looking forward to?', 1, 'Alice', 'written', false, null),
      ($3, $5, $8, 'Which weekends work?', 2, null, 'poll', true, '["June","July","August"]'),
      ($4, $5, $9, 'What did you cook?', 3, null, 'written', false, null)`,
    [id(50), id(51), id(52), id(53), issue, id(20), id(21), id(22), id(23)],
  );
  await rows(
    `insert into issue_questions (id, issue_id, question_id, text, position, format, emoji, description, admin_only, occurrence_date,
                                  about_membership_id, from_section) values
      ($1, $8, $9, 'This week', 1000, 'written', '📝', 'Anything you want to tell us.', false, null, null, true),
      ($2, $8, $10, 'Photo wall', 1001, 'photo_wall', '📸', null, false, null, null, true),
      ($3, $8, $11, 'Song of the week', 1002, 'music', '🎵', 'One song, any service.', false, null, null, true),
      ($4, $8, $12, 'Planning', 1003, 'written', '🗂️', 'Just for the people running things.', true, null, null, true),
      ($5, $8, $13, 'Small wins', 1004, 'written', '🏅', null, false, null, null, true),
      ($6, $8, $14, 'Camping weekend', 1005, 'written', '🏕️', null, false, '2026-10-29', null, true),
      ($7, $8, $15, 'Alice''s birthday', 1006, 'written', '🎂', null, false, '2026-10-28', $16, true)`,
    [id(60), id(61), id(62), id(63), id(64), id(65), id(66), issue, id(30), id(31), id(32), id(33), id(34), id(40), id(41), alice.id],
  );

  // Question answers.
  const reply = async (
    replyId: string,
    issueQuestionId: string,
    membershipId: string,
    minutes: number,
    input: { body?: string; photo?: string; audio?: string; choices?: number[]; late?: boolean; neverSent?: boolean },
  ) =>
    rows(
      `insert into replies (id, issue_id, issue_question_id, membership_id, body, photo_url, audio_url, audio_duration_ms, poll_choices,
                            added_after_delivery, never_sent, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
      [
        replyId, issue, issueQuestionId, membershipId, input.body ?? "", input.photo ?? null, input.audio ?? null,
        input.audio ? 4_000 : null, input.choices ?? [], input.late ?? false, input.neverSent ?? false, at(minutes),
      ],
    );
  await reply(id(70), id(50), sam.id, 10, { body: "The goose on the towpath.", photo: "/uploads/golden-goose.png", audio: "/uploads/golden-honk.webm" });
  await reply(id(71), id(50), alice.id, 20, { body: "My nephew's knock-knock jokes." });
  await reply(id(72), id(50), bob.id, 30, { body: "A late one: the cat in the bread bin.", late: true });
  await reply(id(73), id(51), bob.id, 40, { body: "This draft never went out.", neverSent: true });
  await reply(id(74), id(51), cleo.id, 50, { body: "The first frost." });
  await reply(id(75), id(52), sam.id, 60, { choices: [0, 2] });
  await reply(id(76), id(52), alice.id, 70, { choices: [1] });
  await reply(id(77), id(53), alice.id, 80, { body: "   " });

  // Section answers: answers like any other, a photo wall's photos (and a section's
  // one photo, in a round already out) as `reply_media`.
  const sectionReply = async (
    replyId: string,
    issueSectionId: string,
    membershipId: string,
    minutes: number,
    input: { body?: string; link?: string; late?: boolean; neverSent?: boolean; media?: Array<[string, string, string | null]> },
  ) => {
    await rows(
      `insert into replies (id, issue_id, issue_question_id, membership_id, body, link_url, link_provider,
                            added_after_delivery, never_sent, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [
        replyId, issue, issueSectionId, membershipId, input.body ?? "", input.link ?? null, input.link ? "spotify" : null,
        input.late ?? false, input.neverSent ?? false, at(minutes),
      ],
    );
    for (const [position, [mediaId, url, caption]] of (input.media ?? []).entries()) {
      await rows(
        "insert into reply_media (id, reply_id, url, caption, position, created_at) values ($1, $2, $3, $4, $5, $6)",
        [mediaId, replyId, url, caption, position, at(minutes)],
      );
    }
  };
  await sectionReply(id(80), id(60), alice.id, 90, { body: "Finished the quilt.", media: [[id(90), "/uploads/golden-quilt.png", null]] });
  await sectionReply(id(81), id(60), bob.id, 95, { body: "Not finished.", neverSent: true });
  await sectionReply(id(82), id(61), bob.id, 100, {
    media: [[id(91), "/uploads/golden-lake.png", "The lake at dawn"], [id(92), "/uploads/golden-tent.png", "Tent, mostly up"]],
  });
  await sectionReply(id(83), id(61), sam.id, 110, { late: true, media: [[id(93), "/uploads/golden-fire.png", null]] });
  await sectionReply(id(84), id(62), cleo.id, 120, { body: "For the drive home.", link: GOLDEN.musicUrl });
  await sectionReply(id(85), id(63), sam.id, 130, { body: "Budget looks fine.", media: [[id(95), "/uploads/golden-receipt.png", "Receipts"]] });
  await sectionReply(id(86), id(65), bob.id, 140, { body: "Bring the big tarp." });
  await sectionReply(id(87), id(66), sam.id, 150, { body: "Happy birthday, Alice!", media: [[id(94), "/uploads/golden-cake.png", null]] });
  await rows(
    `insert into music_links (url, provider, title, artwork_url, tracks, track_count, fetched_at)
     values ($1, 'spotify', 'Golden Hour', null, '[]', 1, now())`,
    [GOLDEN.musicUrl],
  );

  // Reactions and comments.
  await rows(
    `insert into reactions (id, reply_id, membership_id, emoji, created_at) values
      ($1, $4, $6, '❤️', $8), ($2, $4, $7, '❤️', $8), ($3, $5, $9, '😂', $8)`,
    [id(100), id(101), id(102), id(70), id(71), alice.id, bob.id, DELIVERED, sam.id],
  );
  await rows(
    `insert into comments (id, issue_id, membership_id, body, reply_id, quote_comment_id, photo_url, created_at) values
      ($1, $3, $4, 'What a round.', null, null, null, $6),
      ($2, $3, $5, $7, $8, null, null, $6)`,
    [id(110), id(111), issue, bob.id, alice.id, DELIVERED, `Best goose, @[${sam.id}]`, id(70)],
  );
}

/** Same seed, but the round is still open: what a delivery of a round like this one sends. */
export async function reopenGoldenRound(): Promise<void> {
  await rows("update issues set status = 'open', delivered_at = null where id = $1", [GOLDEN.issueId]);
}

const GOLDEN_DIR = path.join(process.cwd(), "test", "golden");

/**
 * Ids made at run time (a next round, an outbox row) are numbered by first
 * appearance, and the app's own address, which depends on the port a run got,
 * is `<app>`.
 */
export function stableIds(text: string): string {
  const seen = new Map<string, string>();
  for (const origin of [process.env.E2E_APP_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    if (origin) text = text.split(origin.replace(/\/$/, "")).join("<app>");
  }
  return text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (uuid) => {
    if (uuid.startsWith("00000000-0000-4000-8000-")) return uuid;
    if (!seen.has(uuid)) seen.set(uuid, `<new-id-${seen.size + 1}>`);
    return seen.get(uuid)!;
  });
}

/**
 * Compare `value` with `test/golden/<name>`. A missing file, or `UPDATE_GOLDEN=1`,
 * writes it instead; a missing file still fails, so CI can never pass on nothing.
 */
export function matchGolden(
  name: string,
  value: unknown,
): { ok: true } | { ok: false; expected: string; actual: string } {
  const actual = stableIds(typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  const file = path.join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDEN === "1") {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, actual);
    return { ok: true };
  }
  if (!existsSync(file)) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, actual);
    return { ok: false, expected: `(no ${name} yet: written now, review and commit it)`, actual };
  }
  const expected = readFileSync(file, "utf8");
  if (expected === actual) return { ok: true };
  // Left where a diff tool can reach it: `diff test/golden/<name> <this file>`.
  writeFileSync(path.join(tmpdir(), `golden-actual-${name}`), actual);
  return { ok: false, expected, actual };
}
