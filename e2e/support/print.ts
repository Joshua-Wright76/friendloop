import { rows } from "./db";
import { writeUpload } from "./album";
import { seedPoll } from "./polls";
import { seedDeliveredIssue, seedLoop, type SeededLoop } from "./seed";

export const PQ1 = "What made you laugh this week?";
export const PQ2 = "What are you looking forward to?";
export const PPOLL = "Which weekends work?";
export const LONG_TEXT = Array.from({ length: 40 }, (_, i) => `Sentence number ${i + 1} of a very long story about the shed.`).join(" ");

async function question(issueId: string, text: string): Promise<string> {
  const [row] = await rows<{ id: string }>("select id from issue_questions where issue_id = $1 and text = $2", [issueId, text]);
  return row.id;
}

async function reply(
  issueId: string,
  text: string,
  membershipId: string,
  input: { body?: string; photoUrl?: string; audioUrl?: string; late?: boolean; choices?: number[] },
): Promise<string> {
  const [row] = await rows<{ id: string }>(
    `insert into replies (issue_id, issue_question_id, membership_id, body, photo_url, audio_url, audio_duration_ms, poll_choices, added_after_delivery, status, submitted_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'submitted', now()) returning id`,
    [
      issueId,
      await question(issueId, text),
      membershipId,
      input.body ?? "",
      input.photoUrl ?? null,
      input.audioUrl ?? null,
      input.audioUrl ? 4_000 : null,
      input.choices ?? [],
      input.late ?? false,
    ],
  );
  return row.id;
}

async function sectionReply(
  issueId: string,
  title: string,
  membershipId: string,
  input: { body?: string; link?: { url: string; provider: string }; media?: Array<{ url: string; caption: string | null }>; late?: boolean },
): Promise<void> {
  const [section] = await rows<{ id: string }>("select id from issue_sections where issue_id = $1 and title = $2", [issueId, title]);
  const [created] = await rows<{ id: string }>(
    `insert into section_replies (issue_id, issue_section_id, membership_id, body, link_url, link_provider, added_after_delivery, status, submitted_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'submitted', now()) returning id`,
    [issueId, section.id, membershipId, input.body ?? "", input.link?.url ?? null, input.link?.provider ?? null, input.late ?? false],
  );
  for (const [position, item] of (input.media ?? []).entries()) {
    await rows("insert into section_media (section_reply_id, url, caption, position) values ($1, $2, $3, $4)", [created.id, item.url, item.caption, position]);
  }
}

export const MUSIC_URL = "https://open.spotify.com/track/keepsake";

/**
 * A loop with one delivered round that has a bit of everything the print view has to carry:
 * a long written answer, a photo, a voice note, a late reply, a poll with picks, a suggested
 * question's credit, a standard section, a photo wall, a music pick, an owners-only section,
 * reactions, an issue-level thread, and an answer-level thread with a quote and a mention.
 */
export async function seedKeepsake(input: { shareToken?: string } = {}) {
  const loop = await seedLoop({ questions: [PQ1, PQ2] });
  await seedPoll(loop, { text: PPOLL, options: ["June", "July", "August"], multiple: true });
  const person = (prefix: string) => loop.members.find((member) => member.email.startsWith(prefix))!;
  const [sam, alice, bob] = [person("owner"), person("alice"), person("bob")];
  await rows("update groups set share_enabled = true where id = $1", [loop.groupId]);

  const { issueId } = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [],
    shareToken: input.shareToken ?? "keepsake-share-token",
  });
  await rows("update issues set name = 'Camping weekend' where id = $1", [issueId]);
  await rows("update issue_questions set suggested_by = 'Maya' where issue_id = $1 and text = $2", [issueId, PQ2]);

  const goose = await reply(issueId, PQ1, alice.id, { body: "A goose on the towpath", photoUrl: await writeUpload("print-goose", "png") });
  await reply(issueId, PQ1, bob.id, { body: LONG_TEXT });
  await reply(issueId, PQ1, sam.id, { body: "Forgot to say: the shed finally stood up.", late: true });
  await reply(issueId, PQ2, bob.id, { body: "Listen to the rain", audioUrl: await writeUpload("print-rain", "webm") });
  await reply(issueId, PPOLL, alice.id, { choices: [0, 2] });
  await reply(issueId, PPOLL, bob.id, { choices: [2] });

  await rows(
    `insert into issue_sections (issue_id, kind, title, emoji, position) values
       ($1, 'standard', 'Highlights', '✨', 0),
       ($1, 'photo_wall', 'Photo wall', null, 1),
       ($1, 'music', 'Song of the week', '🎵', 2),
       ($1, 'standard', 'Owners only', null, 3),
       ($1, 'standard', 'Nobody wrote here', null, 4)`,
    [issueId],
  );
  await rows("update issue_sections set admin_only = true where issue_id = $1 and title = 'Owners only'", [issueId]);
  await sectionReply(issueId, "Highlights", alice.id, { body: "The lake swim.", media: [{ url: await writeUpload("print-lake", "png"), caption: null }] });
  await sectionReply(issueId, "Highlights", bob.id, { body: "Added a day later.", late: true });
  await sectionReply(issueId, "Photo wall", alice.id, {
    media: [
      { url: await writeUpload("print-wall-1", "png"), caption: "Marshmallows, obviously" },
      { url: await writeUpload("print-wall-2", "png"), caption: "The bridge at night" },
      { url: await writeUpload("print-wall-3", "png"), caption: "Dawn on the tent" },
    ],
  });
  await rows("insert into music_links (url, provider, title) values ($1, 'spotify', 'Rain Song — The Keepsakes') on conflict do nothing", [MUSIC_URL]);
  await sectionReply(issueId, "Song of the week", bob.id, { body: "On repeat.", link: { url: MUSIC_URL, provider: "spotify" } });
  await sectionReply(issueId, "Owners only", sam.id, { body: "Budget stays secret." });

  for (const member of [bob, sam]) {
    await rows("insert into reactions (reply_id, membership_id, emoji) values ($1, $2, '❤️')", [goose, member.id]);
  }

  const [lead] = await rows<{ id: string }>(
    "insert into comments (issue_id, membership_id, body) values ($1, $2, 'What a round!') returning id",
    [issueId, sam.id],
  );
  await rows(
    "insert into comments (issue_id, membership_id, body, reply_id, quote_comment_id, created_at) values ($1, $2, $3, $4, null, now())",
    [issueId, bob.id, `Best goose ever @[${alice.id}]`, goose],
  );
  await rows(
    "insert into comments (issue_id, membership_id, body, quote_comment_id, created_at) values ($1, $2, 'Agreed!', $3, now() + interval '1 second')",
    [issueId, alice.id, lead.id],
  );

  return { loop, issueId, alice, bob, sam, shareToken: input.shareToken ?? "keepsake-share-token" };
}

export type { SeededLoop };
