import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { questions } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { viewerFor } from "@/lib/permissions";
import { addAction } from "./actions";
import { QuestionOrder } from "./question-order";
import { LoopNav } from "@/components/loop-nav";
import { copy } from "@/lib/copy";

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

  const viewer = await viewerFor(id, user);
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
          {copy.common.backToLoop}
        </Link>
      </header>
      <LoopNav id={id} active="Questions" />

      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">{copy.questions.title}</h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
        {copy.questions.description}
      </p>

      {notices.added ? <Notice>{copy.questions.addedNotice}</Notice> : null}
      {notices.archived ? <Notice>{copy.questions.archivedNotice}</Notice> : null}

      {manages && pool.length ? <QuestionOrder groupId={id} questions={pool.map(({ id: questionId, text, skipNext }) => ({ id: questionId, text, skipNext }))} /> : (
        <ol className="mt-5 flex flex-col gap-2.5" aria-label={copy.questions.listLabel}>
          {pool.map((question, index) => <li key={question.id} className="card paper p-4"><div className="flex items-start gap-3"><span className="question-number">{index + 1}</span><div><p className="text-[15px] font-medium leading-snug text-ink">{question.text}</p>{question.skipNext ? <p className="mt-1 text-[12px] font-medium text-ink-muted">{copy.questions.skipNextNote}</p> : null}</div></div></li>)}
          {pool.length === 0 ? <li className="card p-5 text-[14px] text-ink-muted"><p>{copy.questions.empty}</p>{manages ? <a href="#question-form" className="btn btn-primary mt-4 inline-flex">{copy.questions.firstQuestionAction}</a> : null}</li> : null}
        </ol>
      )}

      {manages ? (
        <form action={addAction} id="question-form" className="card mt-5 p-5">
          <input type="hidden" name="groupId" value={id} />
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.questions.addTitle}</h2>
          <input
            name="text"
            required
            maxLength={200}
            placeholder={copy.questions.newQuestionPlaceholder}
            aria-label={copy.questions.newQuestionAriaLabel}
            className="field mt-3 h-[46px] py-0"
          />
          <button type="submit" className="btn btn-primary mt-3">
            {copy.questions.add}
          </button>
        </form>
      ) : null}
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="notice settle mt-4 border bg-accent-soft px-4 py-3 text-[14px] leading-relaxed">
      {children}
    </div>
  );
}
