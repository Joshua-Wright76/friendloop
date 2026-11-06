import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { and, asc, countDistinct, desc, eq, isNull, like } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/db";
import { groups, issues, memberships, outbox, questions, replies } from "@/db/schema";
import { pendingSuggestions } from "@/lib/suggestions";
import { sectionsOf } from "@/lib/sections";
import { eventsOf } from "@/lib/events";
import { currentUser } from "@/lib/auth";
import { getNow } from "@/lib/clock";
import { membersOf } from "@/lib/manage";
import { describeDeadline, upcomingSlot, weekdayName } from "@/lib/schedule";
import { url } from "@/lib/urls";
import LoopLoading from "./loading";
import { LoopTheme } from "@/components/loop-theme";
import { formatMoment, timezonePlace } from "@/lib/format";
import { LoopDataProvider, type LoopData } from "./loop-data";
import { TimezoneSync } from "@/app/you/timezone-sync";

type Props = {
  children: ReactNode;
  params: Promise<{ id: string }>;
};

// Every route under /g is somebody's private loop.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function GroupLayout(props: Props) {
  return (
    <Suspense fallback={<LoopLoading />}>
      <LoadedGroupLayout {...props} />
    </Suspense>
  );
}

/** A moment on the reader's own clock, and on the loop's when the two differ. */
function momentsOf(instant: Date, loopTimezone: string, viewerTimezone: string | null | undefined) {
  // An unlabelled time is a promise that it's the reader's own. If we don't know theirs, name the place.
  if (!viewerTimezone) return { primary: `${formatMoment(instant, loopTimezone)} ${timezonePlace(loopTimezone)} time`, loop: null };
  if (viewerTimezone === loopTimezone) return { primary: formatMoment(instant, loopTimezone), loop: null };
  return {
    primary: `${formatMoment(instant, viewerTimezone)} your time`,
    loop: `${formatMoment(instant, loopTimezone)} in ${timezonePlace(loopTimezone)}`,
  };
}

async function LoadedGroupLayout({ children, params }: Props) {
  const [{ id }, user] = await Promise.all([params, currentUser()]);
  if (!user) redirect("/signin");

  const [row] = await db
    .select({
      group: groups,
      membership: {
        id: memberships.id,
        groupId: memberships.groupId,
        userId: memberships.userId,
        email: memberships.email,
        name: memberships.name,
        photoUrl: memberships.photoUrl,
        access: memberships.access,
        participation: memberships.participation,
        invitedAt: memberships.invitedAt,
        acceptedAt: memberships.acceptedAt,
      },
    })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(and(
      eq(memberships.groupId, id),
      eq(memberships.userId, user.id),
      isNull(memberships.revokedAt),
    ))
    .limit(1);

  if (!row) notFound();

  const { group, membership } = row;
  // "Now" belongs to this request, never to a prerender.
  await connection();
  const at = await getNow();
  const [people, questionRows, roundRows, answerRows, suggestionRows, sectionRows, eventRows] = await Promise.all([
    membersOf(group.id),
    db.select({
      id: questions.id,
      text: questions.text,
      active: questions.active,
      skipNext: questions.skipNext,
      position: questions.position,
      kind: questions.kind,
      pollMultiple: questions.pollMultiple,
      pollOptions: questions.pollOptions,
    })
      .from(questions)
      .where(and(eq(questions.groupId, group.id), isNull(questions.archivedAt)))
      .orderBy(asc(questions.position)),
    db.select({
      id: issues.id,
      number: issues.number,
      name: issues.name,
      status: issues.status,
      opensAt: issues.opensAt,
      deliversAt: issues.deliversAt,
      deliveredAt: issues.deliveredAt,
      shareToken: issues.shareToken,
    })
      .from(issues)
      .where(eq(issues.groupId, group.id))
      .orderBy(desc(issues.number)),
    // People who sent answers, per round. A separate grouped query: a correlated
    // subquery in a single-table select renders unqualified columns, which then
    // resolve against `replies` itself and always counted zero.
    db.select({ issueId: replies.issueId, people: countDistinct(replies.membershipId) })
      .from(replies)
      .innerJoin(issues, eq(issues.id, replies.issueId))
      .where(and(eq(issues.groupId, group.id), eq(replies.status, "submitted")))
      .groupBy(replies.issueId),
    pendingSuggestions(group.id),
    sectionsOf(group.id),
    membership.access === "member" ? Promise.resolve([]) : eventsOf(group, at),
  ]);

  const answeredBy = new Map(answerRows.map((row) => [row.issueId, row.people]));
  const rounds: LoopData["rounds"] = roundRows.map((round) => ({
    ...round,
    answers: answeredBy.get(round.id) ?? 0,
    shareUrl:
      group.shareEnabled && round.shareToken ? url(`/s/${round.shareToken}`) : null,
  }));
  const openIssue = rounds.find((round) => round.status === "open") ?? null;
  const openProgress = openIssue
    ? await db
        .selectDistinct({ id: memberships.id, name: memberships.name, email: memberships.email })
        .from(replies)
        .innerJoin(memberships, eq(memberships.id, replies.membershipId))
        .where(and(eq(replies.issueId, openIssue.id), eq(replies.status, "submitted")))
    : [];
  // The owner's nudges are mail like any other, so the outbox remembers the last one.
  const [lastNudgeRow] = openIssue
    ? await db
        .select({ at: outbox.createdAt })
        .from(outbox)
        .where(and(eq(outbox.issueId, openIssue.id), like(outbox.dedupeKey, "manual-reminder:%")))
        .orderBy(desc(outbox.createdAt))
        .limit(1)
    : [];
  const answered = new Set(openProgress.map((person) => person.id));
  const openWaiting = openIssue
    ? people.filter((person) => person.participation === "contributor" && !answered.has(person.id))
    : [];

  const next = upcomingSlot({
    timezone: group.timezone,
    promptWeekday: group.promptWeekday,
    promptHour: group.promptHour,
    cadenceWeeks: group.cadenceWeeks,
    windowDays: group.windowDays,
    createdAt: group.createdAt,
    lastSlotAt: group.lastSlotAt,
  }, at);

  const data: LoopData = {
    group,
    membership,
    user,
    people,
    questions: questionRows,
    sections: sectionRows.map((section) => ({
      id: section.id,
      kind: section.kind,
      title: section.title,
      emoji: section.emoji,
      description: section.description,
      adminOnly: section.adminOnly,
      active: section.active,
      position: section.position,
    })),
    events: eventRows,
    suggestions: suggestionRows.map((suggestion) => ({
      id: suggestion.id,
      text: suggestion.text,
      authorDisplay: suggestion.authorDisplay,
      authorName: suggestion.authorName,
      authorEmail: suggestion.authorEmail,
    })),
    rounds,
    openIssue,
    openProgress,
    openWaiting,
    nextRoundLabel: describeDeadline(next, group.timezone, user.timezone),
    openIssueDeadlineLabel: openIssue
      ? describeDeadline(openIssue.deliversAt, group.timezone, user.timezone).inLoopZone
      : null,
    nextMoment: momentsOf(next, group.timezone, user.timezone),
    nextWhenThisCloses: Boolean(openIssue && Math.abs(openIssue.deliversAt.getTime() - next.getTime()) < 60_000),
    lastNudge: lastNudgeRow?.at ? formatMoment(lastNudgeRow.at, user.timezone || group.timezone) : null,
    openMoment: openIssue ? momentsOf(openIssue.deliversAt, group.timezone, user.timezone) : null,
    weekdayLabel: weekdayName(group.promptWeekday),
  };

  return (
    <LoopDataProvider data={data}>
      <TimezoneSync stored={user.timezone} />
      <LoopTheme preset={group.themePreset} accent={group.themeAccent} />
      {children}
    </LoopDataProvider>
  );
}
