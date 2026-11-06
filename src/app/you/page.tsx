import { SafeForm } from "@/components/safe-form";
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { currentUser } from "@/lib/auth";
import { getNow } from "@/lib/clock";
import { formatDate, atMoment, formatMoment } from "@/lib/format";
import { groupSchedule, upcomingSlot } from "@/lib/schedule";
import { Brand, Cherries, Tape } from "@/components/stationery";
import { NoticeFocus } from "@/components/notice-focus";
import { copy, text } from "@/lib/copy";
import { signOutAction } from "./actions";
import { TimezoneSync } from "./timezone-sync";
import { SubmitButton } from "@/components/submit-button";

export const instant = false;

export const metadata: Metadata = {
  title: copy.pageTitles.yourLoops,
  robots: { index: false, follow: false },
};

export default async function YouPage({ searchParams }: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const { deleted } = await searchParams;

  const [loops, at] = await Promise.all([loopCards(user.id), getNow()]);

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-16 pt-6 sm:px-6">
      <TimezoneSync stored={user.timezone} />
      <div className="loop-head">
        <header className="loop-head__row">
          <Brand href={null} />
          <SafeForm action={signOutAction}>
            <SubmitButton className="btn btn-quiet h-11 min-h-11 px-4 text-[13px]">{copy.common.signOut}</SubmitButton>
          </SafeForm>
        </header>
        <div className="loop-head__page flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1>{copy.you.title}</h1>
            <p className="[overflow-wrap:anywhere]">{text(copy.you.signedInAs, { email: user.email })}</p>
          </div>
          <Link href="/g/new" className="btn btn-primary">{copy.you.newLoop}</Link>
        </div>
      </div>

      {deleted ? (
        <NoticeFocus spacing="mt-5">{copy.you.deletedNotice}</NoticeFocus>
      ) : null}
      {loops.length === 0 ? (
        <div className="card mt-8 p-6 pt-8">
          <Tape tone="mint" />
          <h2 className="text-ink">{copy.you.emptyTitle}</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
            {copy.you.emptyBody}
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-5 sm:grid-cols-2">
          {loops.map((loop, index) => (
            <li key={loop.id} className="flex">
            <Link href={`/g/${loop.id}`} className="card loop-card flex min-h-[156px] w-full flex-col p-5 pt-6 no-underline">
              {index === 0 ? <Tape tone="dots" position="right" /> : null}
              <span className="flex items-center gap-2">
                <Cherries className="h-7 w-7 flex-none" />
                <span className="font-display text-[27px] font-bold leading-none text-ink">{loop.name}</span>
              </span>
              <span className="mt-3 block text-[14px] font-semibold leading-snug text-ink-soft numeric">
                {statusLine(loop, at, user.timezone)}
              </span>
              <span className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-line-strong bg-page px-2.5 py-1 text-[12px] font-bold capitalize text-ink-soft">
                  {copy.common.roles[loop.access]}
                </span>
              </span>
              <span className="mt-auto flex items-center justify-between pt-4 text-[14px] font-extrabold text-ink-soft">
                {copy.you.openLoop} <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4"><path d="M4 10h11M11 6l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            </Link>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="your-data" className="card mt-10 p-5">
        <h2 id="your-data" className="text-[22px] text-ink">{copy.you.dataTitle}</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.you.dataBody}</p>
        <div className="mt-4 flex flex-wrap justify-between gap-3">
          <a href="/you/export" download className="btn btn-quiet">{copy.you.download}</a>
          <Link href="/you/delete" className="btn btn-danger-quiet sm:ml-auto">{copy.you.deleteAccount}</Link>
        </div>
        <p className="mt-4 text-[13px] text-ink-muted">
          <Link href="/privacy" className="link link--quiet">{copy.you.privacyLink}</Link>
        </p>
      </section>
    </main>
  );
}

type LoopCard = {
  id: string;
  name: string;
  access: "owner" | "admin" | "member";
  timezone: string;
  promptWeekday: number;
  promptHour: number;
  cadenceWeeks: number;
  windowDays: number;
  createdAt: Date;
  lastSlotAt: Date | null;
  pausedAt: Date | null;
  issueNumber: number | null;
  issueStatus: "open" | "delivered" | null;
  deliversAt: Date | null;
  deliveredAt: Date | null;
  answered: number;
  writers: number;
};

/**
 * Every loop with its latest round, in one query: the lateral join picks each
 * loop's newest round that was not skipped, and the counts ride along with it.
 */
async function loopCards(userId: string): Promise<LoopCard[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select g.id, g.name, m.access, g.timezone,
      g.prompt_weekday, g.prompt_hour, g.cadence_weeks, g.window_days,
      g.created_at, g.last_slot_at, g.paused_at,
      li.number as issue_number, li.status as issue_status, li.delivers_at, li.delivered_at,
      coalesce(li.answered, 0)::int as answered,
      (select count(*)::int from memberships w
        where w.group_id = g.id and w.revoked_at is null and w.participation = 'contributor') as writers
    from memberships m
    join groups g on g.id = m.group_id
    left join lateral (
      select i.number, i.status, i.delivers_at, i.delivered_at,
        (select count(distinct r.membership_id) from replies r
          where r.issue_id = i.id and r.status = 'submitted') as answered
      from issues i
      where i.group_id = g.id and i.status <> 'skipped'
      order by i.number desc
      limit 1
    ) li on true
    where m.user_id = ${userId} and m.revoked_at is null
    order by m.created_at
  `);
  const date = (value: unknown) => (value == null ? null : new Date(value as string | Date));
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    access: row.access as LoopCard["access"],
    timezone: String(row.timezone),
    promptWeekday: Number(row.prompt_weekday),
    promptHour: Number(row.prompt_hour),
    cadenceWeeks: Number(row.cadence_weeks),
    windowDays: Number(row.window_days),
    createdAt: date(row.created_at)!,
    lastSlotAt: date(row.last_slot_at),
    pausedAt: date(row.paused_at),
    issueNumber: row.issue_number == null ? null : Number(row.issue_number),
    issueStatus: (row.issue_status ?? null) as LoopCard["issueStatus"],
    deliversAt: date(row.delivers_at),
    deliveredAt: date(row.delivered_at),
    answered: Number(row.answered),
    writers: Number(row.writers),
  }));
}

/** One line of where the loop stands, in the reader's own zone. */
function statusLine(loop: LoopCard, at: Date, timezone: string): string {
  if (loop.issueStatus === "open" && loop.issueNumber != null && loop.deliversAt) {
    return text(copy.you.status.open, {
      number: loop.issueNumber,
      date: `${atMoment(formatMoment(loop.deliversAt, timezone))}${timezone && timezone !== loop.timezone ? " your time" : ""}`,
      answered: loop.answered,
      writers: loop.writers,
    });
  }
  if (loop.pausedAt) return copy.you.status.paused;
  if (loop.issueStatus === "delivered" && loop.deliveredAt) {
    return text(copy.you.status.delivered, { date: formatDate(loop.deliveredAt, timezone) });
  }
  return text(copy.you.status.first, { date: formatDate(upcomingSlot(groupSchedule(loop), at), timezone) });
}
