/**
 * The numbers behind /dev/stats: is the beta going anywhere, and is mail reaching
 * people? Counts and loop names only, never what anyone wrote.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { answeredCountSql } from "./reply-query";
import { dailySendBudget, sentInLastDay } from "./email/send";

export type LoopStat = {
  id: string;
  name: string;
  owner: string | null;
  people: number;
  rounds: number;
  latestAnswered: number | null;
  latestWriters: number | null;
  paused: boolean;
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
  loops: LoopStat[];
  blocked: string[];
};

export async function readStats(): Promise<Stats> {
  const [totals] = await db.execute<Record<string, number | string | Date | null>>(sql`
    select
      (select count(*)::int from users where not is_synthetic and blocked_at is null) as people,
      (select count(*)::int from groups where not is_synthetic and paused_at is null) as active_loops,
      (select count(*)::int from groups where not is_synthetic and paused_at is not null) as paused_loops,
      (select count(*)::int from issues i join groups g on g.id = i.group_id
        where not g.is_synthetic and i.status = 'delivered') as delivered,
      (select count(*)::int from issues i join groups g on g.id = i.group_id
        where not g.is_synthetic and i.status = 'open') as open,
      (select count(*)::int from outbox where status in ('pending', 'failed')) as unsent,
      (select count(*)::int from email_suppressions where reason = 'bounce') as bounced,
      (select count(*)::int from email_suppressions where reason = 'complaint') as complaints,
      (select count(*)::int from feedback) as feedback,
      (select last_ok_at from heartbeats where name = 'sweep') as last_sweep
  `);

  const loops = await db.execute<Record<string, unknown>>(sql`
    select g.id, g.name, g.paused_at,
      (select m.email from memberships m where m.group_id = g.id and m.access = 'owner' limit 1) as owner,
      (select count(*)::int from memberships m where m.group_id = g.id and m.revoked_at is null) as people,
      (select count(*)::int from issues i where i.group_id = g.id and i.status <> 'skipped') as rounds,
      latest.answered, latest.writers
    from groups g
    left join lateral (
      select
        ${answeredCountSql("i")} as answered,
        (select count(*)::int from memberships w
          where w.group_id = g.id and w.revoked_at is null and w.participation = 'contributor') as writers
      from issues i
      where i.group_id = g.id and i.status <> 'skipped'
      order by i.number desc
      limit 1
    ) latest on true
    where not g.is_synthetic
    order by g.paused_at is not null, g.created_at desc
  `);

  const blocked = await db.execute<{ email: string }>(
    sql`select email from users where blocked_at is not null order by blocked_at desc`,
  );

  const [sent, budget] = [await sentInLastDay(), dailySendBudget()];

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
    budget,
    lastSweepAt: totals.last_sweep ? new Date(totals.last_sweep as string | Date) : null,
    loops: loops.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      owner: row.owner == null ? null : String(row.owner),
      people: Number(row.people),
      rounds: Number(row.rounds),
      latestAnswered: row.answered == null ? null : Number(row.answered),
      latestWriters: row.writers == null ? null : Number(row.writers),
      paused: row.paused_at != null,
    })),
    blocked: blocked.map((row) => row.email),
  };
}
