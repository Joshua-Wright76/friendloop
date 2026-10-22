#!/usr/bin/env node
/**
 * A loop you can actually look at: one owner, one contributor with an answer
 * already in, four questions, and an open round.
 *
 *   npm run db:seed
 *
 * Destructive: truncates every table first. Dev database only.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1 });
const GROUP = "11111111-1111-1111-1111-111111111111";

try {
  await sql.begin(async (tx) => {
    await tx.unsafe(`
      truncate table email_events, outbox, reactions, comments, replies,
        issue_questions, issues, questions, memberships, groups,
        sessions, magic_links, users restart identity cascade;
    `);

    await tx`
      insert into groups (id, name, display_name, mode, timezone, prompt_weekday,
        prompt_hour, cadence_weeks, window_days, created_at)
      values (${GROUP}, 'Friday Loop', 'Friday Loop', 'group', 'Europe/Amsterdam',
        5, 9, 1, 7, '2026-01-01T00:00:00Z');
    `;

    await tx`
      insert into memberships (group_id, email, name, access, participation, reply_token, accepted_at)
      values
        (${GROUP}, 'dev@friendloop.test', 'Dev', 'owner', 'contributor', 'dev-reply-token', now()),
        (${GROUP}, 'alice@friendloop.test', 'Alice', 'member', 'contributor', 'alice-reply-token', now()),
        (${GROUP}, 'bob@friendloop.test', 'Bob', 'member', 'reader', 'bob-reply-token', now());
    `;

    await tx`
      insert into questions (group_id, text, position) values
        (${GROUP}, 'What made you laugh this week?', 0),
        (${GROUP}, 'What are you looking forward to?', 1),
        (${GROUP}, 'What''s something small you''re proud of?', 2),
        (${GROUP}, 'What did you eat that was worth remembering?', 3);
    `;

    const [issue] = await tx`
      insert into issues (group_id, number, slot_at, opens_at, delivers_at)
      values (${GROUP}, 3, '2026-10-23T07:00:00Z', '2026-10-23T07:00:00Z', '2026-10-30T08:00:00Z')
      returning id;
    `;

    await tx`
      insert into issue_questions (issue_id, question_id, text, position)
      select ${issue.id}, q.id, q.text, q.position from questions q where q.group_id = ${GROUP};
    `;

    await tx`
      insert into replies (issue_id, issue_question_id, membership_id, body, status, submitted_at)
      select iq.issue_id, iq.id, m.id,
        'Learned that a cat will accept a fist bump but never a high five.',
        'submitted', now()
      from issue_questions iq, memberships m
      where m.reply_token = 'dev-reply-token' and iq.position = 0;
    `;

    // A round that already went out, so the issue page and the archive have content.
    await tx`update groups set share_enabled = true where id = ${GROUP};`;

    const [past] = await tx`
      insert into issues (group_id, number, slot_at, opens_at, delivers_at, status, delivered_at, share_token)
      values (${GROUP}, 2, '2026-10-16T07:00:00Z', '2026-10-16T07:00:00Z',
        '2026-10-23T07:00:00Z', 'delivered', '2026-10-23T07:00:00Z', 'dev-share-token')
      returning id;
    `;

    await tx`
      insert into issue_questions (issue_id, question_id, text, position)
      select ${past.id}, q.id, q.text, q.position from questions q where q.group_id = ${GROUP};
    `;

    await tx`
      insert into replies (issue_id, issue_question_id, membership_id, body, status, submitted_at)
      select iq.issue_id, iq.id, m.id,
        case m.reply_token
          when 'dev-reply-token' then 'Three hours in a bookshop and I regret nothing.'
          else 'I finally finished the shelf I started in March.'
        end,
        'submitted', now()
      from issue_questions iq
      join memberships m on m.reply_token in ('dev-reply-token', 'alice-reply-token')
      where iq.issue_id = ${past.id} and iq.position = 1;
    `;
  });

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log("seeded Friday Loop");
  console.log(`  contributor  ${base}/r/dev-reply-token`);
  console.log(`  owner        ${base}/r/dev-reply-token`);
  console.log(`  reader       ${base}/r/bob-reply-token`);
  console.log(`  sign in as   dev@friendloop.test`);
  console.log(`  past round   ${base}/i/` + "(listed under Rounds)");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
