"use client";

import Link from "next/link";
import { addAction, rotationAction } from "./actions";
import { QuestionOrder } from "./question-order";
import { LoopNav } from "@/components/loop-nav";
import { Picker } from "@/components/picker";
import { copy } from "@/lib/copy";
import { useLoopData } from "../loop-data";

const ROTATION_OPTIONS = [
  { value: "", label: copy.questions.allQuestions },
  ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) })),
];

export default function QuestionsTab({ notices }: { notices: { added?: string; archived?: string; rotation?: string } }) {
  const { group, membership, questions: pool } = useLoopData();
  const id = group.id;
  const manages = membership.access !== "member";

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <header className="mb-5">
        <Link href={`/g/${id}`} className="text-[13px] font-medium text-ink-soft hover:text-ink">
          {copy.common.backToLoop}
        </Link>
      </header>
      <LoopNav id={id} active="Questions" isOwner={membership.access === "owner"} />

      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">{copy.questions.title}</h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
        {copy.questions.description}
      </p>

      {notices.added ? <Notice>{copy.questions.addedNotice}</Notice> : null}
      {notices.archived ? <Notice>{copy.questions.archivedNotice}</Notice> : null}
      {notices.rotation === "1" ? <Notice>{copy.questions.rotationSaved}</Notice> : null}
      {notices.rotation === "invalid" ? <Notice>{copy.questions.rotationInvalid}</Notice> : null}

      {manages ? (
        <form action={rotationAction} className="card mt-5 p-5">
          <input type="hidden" name="groupId" value={id} />
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.questions.rotationTitle}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.questions.rotationDescription}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="min-w-44 flex-1">
              <Picker
                name="questionsPerRound"
                defaultValue={group.questionsPerRound?.toString() ?? ""}
                options={ROTATION_OPTIONS}
                ariaLabel={copy.questions.rotationTitle}
              />
            </div>
            <button type="submit" className="btn btn-quiet">{copy.questions.saveRotation}</button>
          </div>
        </form>
      ) : null}

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
