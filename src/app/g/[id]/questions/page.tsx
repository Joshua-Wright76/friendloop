import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { questions } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { viewerFor } from "@/lib/permissions";
import { addAction, archiveAction, moveAction, skipNextAction } from "./actions";
import { LoopNav } from "@/components/loop-nav";

export const instant = false;

export default async function QuestionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ added?: string; archived?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const { id } = await params;
  const notices = await searchParams;

  const viewer = await viewerFor(id);
  if (!viewer) notFound();
  const manages = viewer.membership.access !== "member";

  const pool = await db
    .select()
    .from(questions)
    .where(and(eq(questions.groupId, id), isNull(questions.archivedAt)))
    .orderBy(asc(questions.position));

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <header className="mb-5">
        <Link href={`/g/${id}`} className="text-[13px] font-medium text-ink-soft hover:text-ink">
          ← Back to loop
        </Link>
      </header>
      <LoopNav id={id} active="Questions" />

      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">Questions</h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
        Everything on the list goes into the next round, top to bottom.
      </p>

      {notices.added ? <Notice>Question added.</Notice> : null}
      {notices.archived ? <Notice>Archived — past rounds keep their wording.</Notice> : null}

      <ol className="mt-5 flex flex-col gap-2.5">
        {pool.map((question, index) => (
          <li key={question.id} className="card paper p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-field text-[11px] font-semibold text-ink-muted numeric">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium leading-snug text-ink">{question.text}</p>
                {question.skipNext ? (
                  <p className="mt-1 text-[12px] font-medium text-ink-muted">
                    Sitting out the next round
                  </p>
                ) : null}
              </div>
            </div>

            {manages ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={moveAction}>
                  <input type="hidden" name="groupId" value={id} />
                  <input type="hidden" name="questionId" value={question.id} />
                  <input type="hidden" name="direction" value="up" />
                  <button
                    type="submit"
                    disabled={index === 0}
                    className="btn btn-quiet h-9 px-3 text-[13px]"
                  >
                    Up
                  </button>
                </form>
                <form action={moveAction}>
                  <input type="hidden" name="groupId" value={id} />
                  <input type="hidden" name="questionId" value={question.id} />
                  <input type="hidden" name="direction" value="down" />
                  <button
                    type="submit"
                    disabled={index === pool.length - 1}
                    className="btn btn-quiet h-9 px-3 text-[13px]"
                  >
                    Down
                  </button>
                </form>
                <form action={skipNextAction}>
                  <input type="hidden" name="groupId" value={id} />
                  <input type="hidden" name="questionId" value={question.id} />
                  <button type="submit" className="btn btn-quiet h-9 px-3 text-[13px]">
                    {question.skipNext ? "Back in" : "Skip next round"}
                  </button>
                </form>
                <form action={archiveAction}>
                  <input type="hidden" name="groupId" value={id} />
                  <input type="hidden" name="questionId" value={question.id} />
                  <button type="submit" className="btn btn-quiet h-9 px-3 text-[13px] text-danger">
                    Archive
                  </button>
                </form>
              </div>
            ) : null}
          </li>
        ))}
        {pool.length === 0 ? (
          <li className="card p-5 text-[14px] text-ink-muted">No questions yet.</li>
        ) : null}
      </ol>

      {manages ? (
        <form action={addAction} className="card mt-5 p-5">
          <input type="hidden" name="groupId" value={id} />
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Add a question</h2>
          <input
            name="text"
            required
            maxLength={200}
            placeholder="What did you learn this week?"
            aria-label="New question"
            className="field mt-3 h-[46px] py-0"
          />
          <button type="submit" className="btn btn-primary mt-3">
            Add question
          </button>
        </form>
      ) : null}
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
