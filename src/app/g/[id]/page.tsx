import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { groups, issues, memberships, questions, replies } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { getNow } from "@/lib/clock";
import { describeDeadline, nextSlot, weekdayName } from "@/lib/schedule";
import { pauseAction, sendNowAction } from "./actions";

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
    <main className="mx-auto w-full max-w-[560px] px-4 pb-16 pt-5">
      <header className="mb-5 flex items-center justify-between gap-3">
        <Link href="/you" className="text-[13px] font-medium text-ink-soft hover:text-ink">
          ← Your loops
        </Link>
        <span className="rounded-full border border-line bg-card px-2.5 py-1 text-[12px] font-medium capitalize text-ink-soft">
          {membership.access}
        </span>
      </header>

      {welcome === "1" ? (
        <div className="settle mb-4 rounded-xl border border-accent-line bg-accent-soft px-4 py-3 text-[14px] leading-relaxed text-accent-ink">
          Loop created. Invite a couple of people and the first round will go out on schedule.
        </div>
      ) : null}

      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">
        {group.name}
      </h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
        Every {group.cadenceWeeks === 1 ? "week" : `${group.cadenceWeeks} weeks`} on{" "}
        {weekdayName(group.promptWeekday)} at {group.promptHour}:00, {group.timezone}.
      </p>

      <div className="card mt-5 p-5">
        <p className="text-[13px] font-medium text-ink-muted">
          {group.pausedAt ? "Paused" : "Next round"}
        </p>
        <p className="mt-1 text-[19px] font-semibold leading-snug tracking-[-0.015em] text-ink">
          {group.pausedAt ? "Nothing scheduled" : nextLabel.inLoopZone}
        </p>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">
          {group.pausedAt
            ? "Nothing goes out until you resume it."
            : nextLabel.inViewerZone
              ? `That's ${nextLabel.inViewerZone} where you are.`
              : "Opens for answers then."}
        </p>

        {manages ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <form action={sendNowAction}>
              <input type="hidden" name="groupId" value={group.id} />
              <button type="submit" className="btn btn-primary h-10 text-[14px]">
                Send now
              </button>
            </form>
            <form action={pauseAction}>
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="paused" value={group.pausedAt ? "0" : "1"} />
              <button type="submit" className="btn btn-quiet h-10 text-[14px]">
                {group.pausedAt ? "Resume" : "Pause"}
              </button>
            </form>
          </div>
        ) : null}
      </div>

      {openIssue ? (
        <div className="card mt-3 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13px] font-medium text-ink-muted">Round {openIssue.number}</p>
            <p className="text-[13px] font-medium text-ink-soft numeric">
              {progress.length} of {writers} in
            </p>
          </div>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">
            Closes{" "}
            {describeDeadline(openIssue.deliversAt, group.timezone, user.timezone).inLoopZone}.
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
              <span className="text-[13px] text-ink-muted">Nobody yet.</span>
            ) : null}
          </div>
          <Link
            href={`/g/${group.id}/issues`}
            className="mt-3 inline-block text-[14px] font-medium text-accent hover:underline"
          >
            See the round
          </Link>
        </div>
      ) : null}

      <nav className="mt-3 grid grid-cols-2 gap-2.5">
        <Link href={`/g/${group.id}/members`} className="card px-4 py-3.5 hover:shadow-[var(--shadow-lift)]">
          <span className="block text-[15px] font-medium text-ink">People</span>
          <span className="mt-0.5 block text-[13px] text-ink-muted numeric">{people.length} in the loop</span>
        </Link>
        <Link href={`/g/${group.id}/questions`} className="card px-4 py-3.5 hover:shadow-[var(--shadow-lift)]">
          <span className="block text-[15px] font-medium text-ink">Questions</span>
          <span className="mt-0.5 block text-[13px] text-ink-muted numeric">{pool.length} in the pool</span>
        </Link>
        <Link href={`/g/${group.id}/issues`} className="card px-4 py-3.5 hover:shadow-[var(--shadow-lift)]">
          <span className="block text-[15px] font-medium text-ink">Rounds</span>
          <span className="mt-0.5 block text-[13px] text-ink-muted">Archive and delivery</span>
        </Link>
        {isOwner ? (
          <Link href={`/g/${group.id}/settings`} className="card px-4 py-3.5 hover:shadow-[var(--shadow-lift)]">
            <span className="block text-[15px] font-medium text-ink">Settings</span>
            <span className="mt-0.5 block text-[13px] text-ink-muted">Schedule and sharing</span>
          </Link>
        ) : null}
      </nav>
    </main>
  );
}
