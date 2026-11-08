import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { and, desc, eq, isNull, like } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/db";
import { groups, issues, memberships, outbox } from "@/db/schema";
import { answeredCountSql } from "@/lib/reply-query";
import { answeredMemberIds } from "@/lib/answered";
import { pendingSuggestions } from "@/lib/suggestions";
import { questionsPageOf } from "@/lib/questions-page";
import { deliveredRoundsAnsweredByEveryone } from "@/lib/rounds-by-member";
import { currentUser } from "@/lib/auth";
import { getNow } from "@/lib/clock";
import { membersOf } from "@/lib/manage";
import { describeDeadline, groupSchedule, nextSlot, weekdayName } from "@/lib/schedule";
import { url } from "@/lib/urls";
import { ownAnswerHref } from "@/lib/answer-link";
import LoopLoading from "./loading";
import { LoopTheme } from "@/components/loop-theme";
import { formatMoment, timezonePlace } from "@/lib/format";
import { LoopDataProvider, type LoopData } from "./loop-data";
import { TimezoneSync } from "@/app/you/timezone-sync";
import { KeepSignedIn } from "@/components/keep-signed-in";

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
        charm: memberships.charm,
        avatarFrame: memberships.avatarFrame,
        access: memberships.access,
        participation: memberships.participation,
        invitedAt: memberships.invitedAt,
        acceptedAt: memberships.acceptedAt,
      },
      // The viewer's own reply link, kept apart from `membership` so that only the
      // ready-made href below (never the token on its own) travels to the client.
      replyToken: memberships.replyToken,
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

  const { group, membership, replyToken } = row;
  // "Now" belongs to this request, never to a prerender.
  await connection();
  const at = await getNow();
  const [people, questionsPage, roundRows, answerRows, suggestionRows, answeredIn] = await Promise.all([
    membersOf(group.id),
    questionsPageOf({ group, viewer: membership, at }),
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
    // People who have written something, per round.
    db.select({ issueId: issues.id, people: answeredCountSql("issues") })
      .from(issues)
      .where(eq(issues.groupId, group.id)),
    pendingSuggestions(group.id),
    // For the rounds list's "who answered" filter, so it filters without a request.
    deliveredRoundsAnsweredByEveryone({ groupId: group.id, includeAdminOnly: membership.access !== "member" }),
  ]);

  const answeredBy = new Map(answerRows.map((row) => [row.issueId, row.people]));
  const rounds: LoopData["rounds"] = roundRows.map((round) => ({
    ...round,
    answers: answeredBy.get(round.id) ?? 0,
    shareUrl:
      group.shareEnabled && round.shareToken ? url(`/s/${round.shareToken}`) : null,
  }));
  const openIssue = rounds.find((round) => round.status === "open") ?? null;
  const answered = openIssue ? await answeredMemberIds(openIssue.id) : new Set<string>();
  const openProgress = people
    .filter((person) => answered.has(person.id))
    .map((person) => ({ id: person.id, name: person.name, email: person.email }));
  // The owner's nudges are mail like any other, so the outbox remembers the last one.
  const [lastNudgeRow] = openIssue
    ? await db
        .select({ at: outbox.createdAt })
        .from(outbox)
        .where(and(eq(outbox.issueId, openIssue.id), like(outbox.dedupeKey, "manual-reminder:%")))
        .orderBy(desc(outbox.createdAt))
        .limit(1)
    : [];
  const openWaiting = openIssue
    ? people.filter((person) => person.participation === "contributor" && !answered.has(person.id))
    : [];

  // The delivery after the open round's: when the round that opens as it goes out
  // would go out in turn. Without an open round, simply the next delivery.
  const next = nextSlot(
    groupSchedule(group),
    openIssue && openIssue.deliversAt.getTime() > at.getTime() ? openIssue.deliversAt : at,
  );

  const data: LoopData = {
    group,
    membership,
    user,
    people,
    questionsPage,
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
    lastNudge: lastNudgeRow?.at ? formatMoment(lastNudgeRow.at, user.timezone || group.timezone) : null,
    openMoment: openIssue ? momentsOf(openIssue.deliversAt, group.timezone, user.timezone) : null,
    weekdayLabel: weekdayName(group.promptWeekday),
    roundsAnsweredBy: Object.fromEntries(answeredIn),
    answerHref: ownAnswerHref({
      participation: membership.participation,
      replyToken,
      pausedAt: group.pausedAt,
      hasOpenRound: openIssue !== null,
    }),
  };

  return (
    <LoopDataProvider data={data}>
      <TimezoneSync stored={user.timezone} />
      <KeepSignedIn />
      <LoopTheme group={group} />
      {children}
    </LoopDataProvider>
  );
}
