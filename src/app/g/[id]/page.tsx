import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { groups, issues, memberships, questions, replies } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { getNow } from "@/lib/clock";
import { describeDeadline, nextSlot, weekdayName } from "@/lib/schedule";
import { pauseAction, sendNowAction } from "./actions";
import { Cherries, Tape } from "@/components/stationery";
import { LoopNav } from "@/components/loop-nav";
import { copy, text } from "@/lib/copy";

export const instant = false;

export default async function LoopPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ welcome?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const { id } = await params;
  const { welcome } = await searchParams;

  const [row] = await db
    .select({ group: groups, membership: memberships })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(
      and(eq(memberships.groupId, id), eq(memberships.userId, user.id), isNull(memberships.revokedAt)),
    )
    .limit(1);

  if (!row) notFound();

  const { group, membership } = row;
  const manages = membership.access !== "member";
  const isOwner = membership.access === "owner";

  const at = await getNow();
  const next = nextSlot(
    {
      timezone: group.timezone,
      promptWeekday: group.promptWeekday,
      promptHour: group.promptHour,
      cadenceWeeks: group.cadenceWeeks,
      windowDays: group.windowDays,
      createdAt: group.createdAt,
      lastSlotAt: group.lastSlotAt,
    },
    at,
  );
  const nextLabel = describeDeadline(next, group.timezone, user.timezone);

  const [openIssue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.groupId, group.id), eq(issues.status, "open")))
    .orderBy(desc(issues.number))
    .limit(1);

  const progress = openIssue
    ? await db
        .select({ id: memberships.id, name: memberships.name, email: memberships.email })
        .from(replies)
        .innerJoin(memberships, eq(memberships.id, replies.membershipId))
        .where(and(eq(replies.issueId, openIssue.id), eq(replies.status, "submitted")))
    : [];

  const pool = await db
    .select({ id: questions.id, text: questions.text })
    .from(questions)
    .where(and(eq(questions.groupId, group.id), eq(questions.active, true), isNull(questions.archivedAt)))
    .orderBy(asc(questions.position));

  const people = await db
    .select({ id: memberships.id, participation: memberships.participation })
    .from(memberships)
    .where(and(eq(memberships.groupId, group.id), isNull(memberships.revokedAt)));

  const writers = people.filter((person) => person.participation === "contributor").length;

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <header className="stitched flex items-center justify-between gap-3 border-b pb-4">
        <Link href="/you" className="flex min-w-0 items-center gap-2 font-display text-[23px] font-bold text-ink no-underline">
          <Cherries className="h-7 w-7 flex-none" /><span className="truncate">{group.name}</span>
        </Link>
        <span className="chip border bg-card px-2.5 py-1 text-[12px] font-bold capitalize text-ink-soft">{copy.common.roles[membership.access]}</span>
      </header>
      <LoopNav id={group.id} active="Overview" isOwner={isOwner} />

      {welcome === "1" ? (
        <div role="status" className="notice settle mb-5 border bg-accent-soft px-4 py-3 text-[14px] leading-relaxed">
          {copy.loop.welcome}
        </div>
      ) : null}

      <p className="eyebrow">{copy.loop.eyebrow}</p>
      <h1 className="mt-1 text-ink">{group.name}</h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
        {text(copy.loop.schedule, {
          cadence: group.cadenceWeeks === 1 ? copy.loop.cadenceWeek : text(copy.loop.cadenceWeeks, { count: group.cadenceWeeks }),
          weekday: weekdayName(group.promptWeekday),
          hour: group.promptHour,
          timezone: group.timezone,
        })}
      </p>

      <div className="card ride-in mt-6 p-5 pt-7">
        <Tape tone="stripe" />
        <p className="eyebrow">
          {group.pausedAt ? copy.loop.paused : copy.loop.nextRound}
        </p>
        <h2 className="mt-2 text-ink">
          {group.pausedAt ? copy.loop.nothingScheduled : nextLabel.inLoopZone}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
          {group.pausedAt
            ? copy.loop.pausedDescription
            : nextLabel.inViewerZone
              ? text(copy.loop.viewerTimezone, { time: nextLabel.inViewerZone })
              : copy.loop.opensForAnswers}
        </p>

        {manages ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <form action={sendNowAction}>
              <input type="hidden" name="groupId" value={group.id} />
              <button type="submit" className="btn btn-primary h-10 text-[14px]">
                {copy.loop.sendNow}
              </button>
            </form>
            <form action={pauseAction}>
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="paused" value={group.pausedAt ? "0" : "1"} />
              <button type="submit" className="btn btn-quiet h-10 text-[14px]">
                {group.pausedAt ? copy.loop.resume : copy.loop.pause}
              </button>
            </form>
          </div>
        ) : null}
      </div>

      {openIssue ? (
        <div className="card ride-in mt-5 p-5 pt-7">
          <Tape tone="dots" position="right" />
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13px] font-medium text-ink-muted">{text(copy.loop.round, { number: openIssue.number })}</p>
            <p className="text-[13px] font-medium text-ink-soft numeric">
              {text(copy.loop.progress, { answered: progress.length, writers })}
            </p>
          </div>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">
            {text(copy.loop.closes, { deadline: describeDeadline(openIssue.deliversAt, group.timezone, user.timezone).inLoopZone })}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {progress.map((person) => (
              <span
                key={person.id}
                className="rounded-full bg-field px-2.5 py-1 text-[12px] font-medium text-ink-soft"
              >
                {person.name ?? person.email.split("@")[0]}
              </span>
            ))}
            {progress.length === 0 ? (
              <span className="text-[13px] text-ink-muted">{copy.loop.nobody}</span>
            ) : null}
          </div>
          <Link
            href={`/g/${group.id}/issues`}
            className="mt-3 inline-block text-[14px] font-medium text-accent hover:underline"
          >
            {copy.loop.seeRound}
          </Link>
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-4">
        <Link href={`/g/${group.id}/members`} className="card loop-card px-4 py-4 no-underline">
          <span className="block font-display text-[23px] font-bold text-ink">{copy.common.navigation.people}</span>
          <span className="mt-1 block text-[13px] text-ink-muted numeric">{text(copy.loop.peopleCount, { count: people.length })}</span>
        </Link>
        <Link href={`/g/${group.id}/questions`} className="card loop-card px-4 py-4 no-underline">
          <span className="block font-display text-[23px] font-bold text-ink">{copy.common.navigation.questions}</span>
          <span className="mt-1 block text-[13px] text-ink-muted numeric">{text(copy.loop.questionsCount, { count: pool.length })}</span>
        </Link>
      </div>
    </main>
  );
}
