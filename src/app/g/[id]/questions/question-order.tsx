"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { copy, text } from "@/lib/copy";
import { itemsInPreferredOrder, moveItem } from "@/lib/question-order";
import { reorderQuestions } from "./actions";
import type { LoopQuestion } from "../loop-data";
import { PollSummary } from "./poll-summary";
import { archiveAction, skipNextAction } from "./actions";
import { ConfirmAction } from "@/components/confirm-action";

type Question = Pick<LoopQuestion, "id" | "text" | "skipNext" | "kind" | "pollMultiple" | "pollOptions">;

export function QuestionOrder({ groupId, questions: initial }: { groupId: string; questions: Question[] }) {
  const router = useRouter();
  const [orderedIds, setOrderedIds] = useState(() => initial.map((question) => question.id));
  const items = itemsInPreferredOrder(orderedIds, initial);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const draggedId = useRef<string | null>(null);
  // Where keyboard focus should land if the control it was on is moved.
  const refocus = useRef<{ id: string; control: string } | null>(null);

  // A live message is spoken once; leaving it in the page would be read again in browse mode, long after it is true.
  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(""), 3000);
    return () => clearTimeout(timer);
  }, [announcement]);

  useEffect(() => {
    if (movingId) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [movingId]);

  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    if (!document.activeElement || document.activeElement === document.body) {
      document.querySelector<HTMLElement>(`[data-question="${CSS.escape(target.id)}"][data-control="${target.control}"]`)?.focus();
    }
    if (!pending) refocus.current = null;
  }, [orderedIds, items.length, pending]);

  async function move(questionId: string, targetIndex: number) {
    const previousOrder = items.map((item) => item.id);
    const sourceIndex = items.findIndex((item) => item.id === questionId);
    if (sourceIndex < 0 || targetIndex === sourceIndex) return;
    const next = moveItem(items, sourceIndex, targetIndex);
    setOrderedIds(next.map((item) => item.id));
    setMessage("");
    setAnnouncement("");
    setMovingId(null);
    startTransition(async () => {
      try {
        const authoritative = await reorderQuestions(groupId, questionId, targetIndex);
        setOrderedIds(authoritative.map((item) => item.id));
        setAnnouncement(text(copy.a11yStatus.questionMoved, {
          question: items[sourceIndex].text,
          position: authoritative.findIndex((item) => item.id === questionId) + 1,
          total: authoritative.length,
        }));
        router.refresh();
      } catch {
        setOrderedIds(previousOrder);
        setMessage(copy.questions.orderError);
      }
    });
  }

  return (
    <>
      <ol className="mt-5 flex flex-col gap-2.5" aria-label={copy.questions.listLabel}>
        {items.map((question, index) => (
          <li key={question.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault();
            const id = draggedId.current;
            if (id) void move(id, index);
            draggedId.current = null;
          }} className={`card paper question-order-item p-4 ${pending ? "is-reordering" : ""}`}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-field text-[11px] font-semibold text-ink-muted numeric">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium leading-snug text-ink">{question.text}</p>
                <PollSummary question={question} />
                {question.skipNext ? <p className="mt-1 text-[12px] font-medium text-ink-muted">{copy.questions.skipNextNote}</p> : null}
              </div>
              <button type="button" draggable aria-disabled={pending ? true : undefined} data-question={question.id} data-control="handle" aria-label={text(copy.questions.moveItemLabel, { question: question.text })} title={copy.questions.dragHandle}
                onDragStart={(event) => { if (pending) { event.preventDefault(); return; } draggedId.current = question.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", question.id); }}
                onDragEnd={() => { draggedId.current = null; }} className="question-drag-handle btn btn-quiet h-11 w-11 min-h-11 flex-none p-0! aria-disabled:cursor-not-allowed aria-disabled:opacity-45" onClick={() => { if (!pending) setMovingId(question.id); }}>
                <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5 flex-none" fill="currentColor">{[4, 10, 16].flatMap((y) => [7, 13].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}</svg>
              </button>
            </div>
            <div className="question-order-controls mt-3 flex flex-wrap gap-2">
              <button type="button" aria-disabled={pending || index === 0 ? true : undefined} data-question={question.id} data-control="up" aria-label={text(copy.a11yLabels.withQuestion, { label: copy.questions.up, question: question.text })} onClick={() => { if (pending || index === 0) return; refocus.current = { id: question.id, control: "up" }; void move(question.id, index - 1); }} className="question-step btn btn-quiet h-11 min-h-11 px-3 text-[13px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45">{copy.questions.up}</button>
              <button type="button" aria-disabled={pending || index === items.length - 1 ? true : undefined} data-question={question.id} data-control="down" aria-label={text(copy.a11yLabels.withQuestion, { label: copy.questions.down, question: question.text })} onClick={() => { if (pending || index === items.length - 1) return; refocus.current = { id: question.id, control: "down" }; void move(question.id, index + 1); }} className="question-step btn btn-quiet h-11 min-h-11 px-3 text-[13px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45">{copy.questions.down}</button>
              <button type="button" aria-disabled={pending ? true : undefined} data-question={question.id} data-control="move" aria-label={text(copy.a11yLabels.withQuestion, { label: copy.questions.move, question: question.text })} onClick={() => { if (!pending) setMovingId(question.id); }} className="question-mobile-move btn btn-quiet h-11 min-h-11 px-3 text-[13px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45">{copy.questions.move}</button>
              <SkipControl groupId={groupId} question={question} />
              <ArchiveControl groupId={groupId} question={question} />
            </div>
          </li>
        ))}
      </ol>
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      <p role="alert" className={message ? "mt-3 text-[14px] text-danger" : undefined}>{message}</p>
      <dialog ref={dialog} aria-labelledby="question-move-title" aria-describedby="question-move-description" onClose={() => setMovingId(null)} className="move-sheet">
        <div className="move-sheet-content">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="question-move-title" className="text-[20px] font-bold text-ink">{copy.questions.moveTitle}</h2>
            <button type="button" onClick={() => dialog.current?.close()} className="btn btn-quiet h-11 min-h-11 px-3 text-[13px]">{copy.common.close}</button>
          </div>
          <p id="question-move-description" className="mb-3 text-[14px] text-ink-soft">{copy.questions.moveDescription}</p>
          <div className="flex max-h-[55dvh] flex-col gap-2 overflow-y-auto">
            {items.map((question, index) => <button key={question.id} type="button" disabled={pending || question.id === movingId}
              onClick={() => movingId && void move(movingId, index)} className="btn btn-quiet min-h-12 w-full justify-start whitespace-normal px-4 py-3 text-left text-[14px]">
              <span className="mr-2 font-bold numeric">{index + 1}.</span>{question.text}
            </button>)}
          </div>
        </div>
      </dialog>
    </>
  );
}

function SkipControl({ groupId, question }: { groupId: string; question: Question }) {
  // The action redirects back to this page with a notice, which NoticeFocus announces.
  const label = question.skipNext ? copy.questions.backIn : copy.questions.skipNext;
  return (
    <form action={skipNextAction}>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="questionId" value={question.id} />
      <button type="submit" aria-label={text(copy.a11yLabels.withQuestion, { label, question: question.text })} className="btn btn-quiet h-11 min-h-11 px-3 text-[13px]">{label}</button>
    </form>
  );
}

function ArchiveControl({ groupId, question }: { groupId: string; question: Question }) {
  // Archiving takes the question out of the pool for good, so it asks first (WCAG 3.3.4).
  return (
    <ConfirmAction
      action={archiveAction}
      fields={{ groupId, questionId: question.id }}
      label={copy.questions.archive}
      triggerLabel={text(copy.a11yLabels.archiveQuestion, { question: question.text })}
      question={copy.a11yLabels.archiveQuestionQuestion}
      body={copy.a11yLabels.archiveQuestionBody}
      confirmLabel={text(copy.a11yLabels.archiveQuestionConfirm, { question: question.text })}
      cancelLabel={copy.a11yLabels.confirmCancel}
    />
  );
}
