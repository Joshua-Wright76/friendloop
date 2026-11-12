/**
 * Aggregate counts behind /dev/stats. Queries may use ids to count distinct
 * activity, but no id, name, address, loop, or message content leaves this module.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { dailySendBudget, sentInLastDay } from "./email/send";
import { readHealth } from "./health";
import type { HealthReport } from "./health-report";
import { statsWindow, type StatsRange } from "./stats-view";

export type DailyUsage = {
  day: string;
  answers: number;
  activePeople: number;
  rounds: number;
};

export type UsageStats = {
  activePeople: number;
  answers: number;
  rounds: number;
  loops: number;
  previousActivePeople: number;
  previousAnswers: number;
  previousRounds: number;
  previousLoops: number;
  newPeople: number;
  newLoops: number;
  daily: DailyUsage[];
};

export type Stats = {
  people: number;
  activeLoops: number;
  pausedLoops: number;
  delivered: number;
  open: number;
  unsent: number;
  bounced: number;
  complaints: number;
  feedback: number;
  sent: number;
  budget: number;
  lastSweepAt: Date | null;
  health: HealthReport;
  usage: UsageStats;
  members: {
    contributors: number;
    readers: number;
    pending: number;
    muted: number;
  };
  loopSizes: Array<{ key: "solo" | "small" | "medium" | "large"; count: number }>;
};

/** The shared answer definition, without selecting any answer content. */
const REPLY_ACTIVITY_SQL = sql`
  select coalesce(r.submitted_at, r.created_at) as happened_at,
    r.membership_id, i.group_id
  from replies r
  join issues i on i.id = r.issue_id
  join groups g on g.id = i.group_id
  where not g.is_synthetic and not r.never_sent
    and (r.body ~ '\\S' or r.photo_url is not null or r.audio_url is not null
      or r.video_url is not null or jsonb_array_length(r.poll_choices) > 0
      or r.link_url is not null
      or exists (select 1 from reply_media rm where rm.reply_id = r.id))
`;

const SECTION_ACTIVITY_SQL = sql`
  select coalesce(sr.submitted_at, sr.created_at) as happened_at,
    sr.membership_id, i.group_id
  from section_replies sr
  join issues i on i.id = sr.issue_id
  join groups g on g.id = i.group_id
  where not g.is_synthetic and not sr.never_sent
    and (sr.body ~ '\\S' or sr.link_url is not null
      or exists (select 1 from section_media sm where sm.section_reply_id = sr.id))
`;

export async function readStats(range: StatsRange = 30, at: Date = new Date()): Promise<Stats> {
  const { start, end, previousStart } = statsWindow(range, at);

  const totalsQuery = db.execute<Record<string, number | string | null>>(sql`
    select
      (select count(*)::int from users where not is_synthetic and blocked_at is null) as people,
      (select count(*)::int from users where not is_synthetic and blocked_at is null
        and created_at >= ${start.toISOString()} and created_at < ${end.toISOString()}) as new_people,
      (select count(*)::int from groups where not is_synthetic and paused_at is null) as active_loops,
      (select count(*)::int from groups where not is_synthetic
        and created_at >= ${start.toISOString()} and created_at < ${end.toISOString()}) as new_loops,
      (select count(*)::int from groups where not is_synthetic and paused_at is not null) as paused_loops,
      (select count(*)::int from issues i join groups g on g.id = i.group_id
        where not g.is_synthetic and i.status = 'delivered') as delivered,
      (select count(*)::int from issues i join groups g on g.id = i.group_id
        where not g.is_synthetic and i.status = 'open') as open,
      (select count(*)::int from outbox where status in ('pending', 'failed')) as unsent,
      (select count(*)::int from email_suppressions where reason = 'bounce') as bounced,
      (select count(*)::int from email_suppressions where reason = 'complaint') as complaints,
      (select count(*)::int from feedback) as feedback
  `);

  const usageQuery = db.execute<Record<string, number | string>>(sql`
    with activity as (
      ${REPLY_ACTIVITY_SQL}
      and coalesce(r.submitted_at, r.created_at) >= ${previousStart.toISOString()}
      and coalesce(r.submitted_at, r.created_at) < ${end.toISOString()}
      union all
      ${SECTION_ACTIVITY_SQL}
      and coalesce(sr.submitted_at, sr.created_at) >= ${previousStart.toISOString()}
      and coalesce(sr.submitted_at, sr.created_at) < ${end.toISOString()}
    ), rounds as (
      select i.delivered_at as happened_at, i.group_id
      from issues i join groups g on g.id = i.group_id
      where not g.is_synthetic and i.status = 'delivered' and i.delivered_at is not null
        and i.delivered_at >= ${previousStart.toISOString()} and i.delivered_at < ${end.toISOString()}
    )
    select
      (select count(distinct membership_id)::int from activity
        where happened_at >= ${start.toISOString()}) as active_people,
      (select count(*)::int from activity where happened_at >= ${start.toISOString()}) as answers,
      (select count(*)::int from rounds where happened_at >= ${start.toISOString()}) as rounds,
      (select count(distinct group_id)::int from (
        select group_id from activity where happened_at >= ${start.toISOString()}
        union select group_id from rounds where happened_at >= ${start.toISOString()}
      ) current_loops) as loops,
      (select count(distinct membership_id)::int from activity
        where happened_at < ${start.toISOString()}) as previous_active_people,
      (select count(*)::int from activity where happened_at < ${start.toISOString()}) as previous_answers,
      (select count(*)::int from rounds where happened_at < ${start.toISOString()}) as previous_rounds,
      (select count(distinct group_id)::int from (
        select group_id from activity where happened_at < ${start.toISOString()}
        union select group_id from rounds where happened_at < ${start.toISOString()}
      ) previous_loops) as previous_loops
  `);

  const dailyQuery = db.execute<Record<string, number | string>>(sql`
    with days as (
      select (day at time zone 'UTC')::date as day
      from generate_series(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz - interval '1 day', interval '1 day') day
    ), activity as (
      ${REPLY_ACTIVITY_SQL}
      and coalesce(r.submitted_at, r.created_at) >= ${start.toISOString()}
      and coalesce(r.submitted_at, r.created_at) < ${end.toISOString()}
      union all
      ${SECTION_ACTIVITY_SQL}
      and coalesce(sr.submitted_at, sr.created_at) >= ${start.toISOString()}
      and coalesce(sr.submitted_at, sr.created_at) < ${end.toISOString()}
    ), daily_activity as (
      select (happened_at at time zone 'UTC')::date as day, count(*)::int as answers,
        count(distinct membership_id)::int as active_people
      from activity group by day
    ), daily_rounds as (
      select (i.delivered_at at time zone 'UTC')::date as day, count(*)::int as rounds
      from issues i join groups g on g.id = i.group_id
      where not g.is_synthetic and i.status = 'delivered' and i.delivered_at is not null
        and i.delivered_at >= ${start.toISOString()} and i.delivered_at < ${end.toISOString()}
      group by day
    )
    select to_char(d.day, 'YYYY-MM-DD') as day,
      coalesce(a.answers, 0)::int as answers,
      coalesce(a.active_people, 0)::int as active_people,
      coalesce(r.rounds, 0)::int as rounds
    from days d
    left join daily_activity a on a.day = d.day
    left join daily_rounds r on r.day = d.day
    order by d.day
  `);

  const membersQuery = db.execute<Record<string, number | string>>(sql`
    select
      count(*) filter (where m.participation = 'contributor')::int as contributors,
      count(*) filter (where m.participation = 'reader')::int as readers,
      count(*) filter (where m.accepted_at is null)::int as pending,
      count(*) filter (where m.muted_at is not null)::int as muted
    from memberships m join groups g on g.id = m.group_id
    where not g.is_synthetic and m.revoked_at is null
  `);

  const loopSizesQuery = db.execute<Record<string, number | string>>(sql`
    with sizes as (
      select g.id, count(m.id) filter (where m.revoked_at is null) as members
      from groups g left join memberships m on m.group_id = g.id
      where not g.is_synthetic group by g.id
    )
    select
      count(*) filter (where members <= 1)::int as solo,
      count(*) filter (where members between 2 and 3)::int as small,
      count(*) filter (where members between 4 and 6)::int as medium,
      count(*) filter (where members >= 7)::int as large
    from sizes
  `);

  const [totalsRows, usageRows, daily, memberRows, sizeRows, health, sent] = await Promise.all([
    totalsQuery,
    usageQuery,
    dailyQuery,
    membersQuery,
    loopSizesQuery,
    readHealth(at),
    sentInLastDay(),
  ]);
  const totals = totalsRows[0];
  const usage = usageRows[0];
  const members = memberRows[0];
  const sizes = sizeRows[0];

  return {
    people: Number(totals.people),
    activeLoops: Number(totals.active_loops),
    pausedLoops: Number(totals.paused_loops),
    delivered: Number(totals.delivered),
    open: Number(totals.open),
    unsent: Number(totals.unsent),
    bounced: Number(totals.bounced),
    complaints: Number(totals.complaints),
    feedback: Number(totals.feedback),
    sent,
    budget: dailySendBudget(),
    lastSweepAt: health.checks.sweep.lastOkAt ? new Date(health.checks.sweep.lastOkAt) : null,
    health,
    usage: {
      activePeople: Number(usage.active_people),
      answers: Number(usage.answers),
      rounds: Number(usage.rounds),
      loops: Number(usage.loops),
      previousActivePeople: Number(usage.previous_active_people),
      previousAnswers: Number(usage.previous_answers),
      previousRounds: Number(usage.previous_rounds),
      previousLoops: Number(usage.previous_loops),
      newPeople: Number(totals.new_people),
      newLoops: Number(totals.new_loops),
      daily: daily.map((row) => ({
        day: String(row.day),
        answers: Number(row.answers),
        activePeople: Number(row.active_people),
        rounds: Number(row.rounds),
      })),
    },
    members: {
      contributors: Number(members.contributors),
      readers: Number(members.readers),
      pending: Number(members.pending),
      muted: Number(members.muted),
    },
    loopSizes: (["solo", "small", "medium", "large"] as const).map((key) => ({
      key,
      count: Number(sizes[key]),
    })),
  };
}
