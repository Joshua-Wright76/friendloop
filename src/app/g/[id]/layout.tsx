import { Suspense, type ReactNode } from "react";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { groups, issues, memberships, questions, replies } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { getNow } from "@/lib/clock";
import { membersOf } from "@/lib/manage";
import { describeDeadline, nextSlot, weekdayName } from "@/lib/schedule";
import { url } from "@/lib/urls";
import LoopLoading from "./loading";
import { LoopDataProvider, type LoopData } from "./loop-data";

type Props = {
  children: ReactNode;
  params: Promise<{ id: string }>;
};

export default function GroupLayout(props: Props) {
  return (
    <Suspense fallback={<LoopLoading />}>
      <LoadedGroupLayout {...props} />
    </Suspense>
  );
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
  const [people, questionRows, roundRows, at] = await Promise.all([
    membersOf(group.id),
    db.select({
      id: questions.id,
      text: questions.text,
      active: questions.active,
      skipNext: questions.skipNext,
      position: questions.position,
    })
      .from(questions)
      .where(and(eq(questions.groupId, group.id), isNull(questions.archivedAt)))
      .orderBy(asc(questions.position)),
    db.select({
      id: issues.id,
      number: issues.number,
      status: issues.status,
      opensAt: issues.opensAt,
      deliversAt: issues.deliversAt,
      shareToken: issues.shareToken,
      answers: sql<number>`(
        select count(*)::int from ${replies}
        where ${replies.issueId} = ${issues.id} and ${replies.status} = 'submitted'
      )`,
    })
      .from(issues)
      .where(eq(issues.groupId, group.id))
      .orderBy(desc(issues.number)),
    getNow(),
  ]);

  const rounds: LoopData["rounds"] = roundRows.map((round) => ({
    ...round,
    shareUrl: round.shareToken ? url(`/s/${round.shareToken}`) : null,
  }));
  const openIssue = rounds.find((round) => round.status === "open") ?? null;
  const openProgress = openIssue
    ? await db
        .select({ id: memberships.id, name: memberships.name, email: memberships.email })
        .from(replies)
        .innerJoin(memberships, eq(memberships.id, replies.membershipId))
        .where(and(eq(replies.issueId, openIssue.id), eq(replies.status, "submitted")))
    : [];

  const next = nextSlot({
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
    rounds,
    openIssue,
    openProgress,
    nextRoundLabel: describeDeadline(next, group.timezone, user.timezone),
    openIssueDeadlineLabel: openIssue
      ? describeDeadline(openIssue.deliversAt, group.timezone, user.timezone).inLoopZone
      : null,
    weekdayLabel: weekdayName(group.promptWeekday),
  };

  return <LoopDataProvider data={data}>{children}</LoopDataProvider>;
}
