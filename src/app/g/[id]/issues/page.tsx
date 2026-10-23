import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { groups, issues, replies } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { viewerFor } from "@/lib/permissions";
import { url } from "@/lib/urls";
import { LoopNav } from "@/components/loop-nav";

export const instant = false;

export default async function IssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ opened?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const { id } = await params;
  const notices = await searchParams;

  const viewer = await viewerFor(id);
  if (!viewer) notFound();

  const [group] = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
  if (!group) notFound();

  const rounds = await db
    .select({
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
    .where(eq(issues.groupId, id))
    .orderBy(desc(issues.number));

  const open = rounds.find((round) => round.status === "open");

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <header className="mb-5">
        <Link href={`/g/${id}`} className="text-[13px] font-medium text-ink-soft hover:text-ink">
          ← {group.name}
        </Link>
      </header>
      <LoopNav id={id} active="Rounds" isOwner={viewer.membership.access === "owner"} />

      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">Rounds</h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
        {open ? `Round ${open.number} is open now.` : "Nothing open right now."}
      </p>

      {notices.opened ? <Notice>Round {notices.opened} is open and everyone&apos;s been emailed.</Notice> : null}

      <div className="mt-5 flex flex-col gap-2.5">
        {rounds.map((round) => (
          <div key={round.id} className="card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[15px] font-medium text-ink">Round {round.number}</p>
              <span className="rounded-full border border-line px-2.5 py-1 text-[12px] font-medium capitalize text-ink-soft">
                {round.status}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-ink-muted numeric">
              {round.answers} {round.answers === 1 ? "answer" : "answers"}
            </p>

            {round.status !== "open" ? (
              <Link
                href={`/i/${round.id}`}
                className="mt-2 inline-block text-[14px] font-medium text-accent hover:underline"
              >
                Read it
              </Link>
            ) : null}

            {round.shareToken ? (
              <p className="mt-2 break-all text-[12px] text-ink-muted">
                Share link: {url(`/s/${round.shareToken}`)}
              </p>
            ) : null}
          </div>
        ))}
        {rounds.length === 0 ? (
          <div className="card p-5 text-[14px] text-ink-muted">
            No rounds yet. Use <strong>Send now</strong> on the loop page to start one.
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="notice settle mt-4 border bg-accent-soft px-4 py-3 text-[14px] leading-relaxed">
      {children}
    </div>
  );
}
