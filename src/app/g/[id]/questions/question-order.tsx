"use client";

import { SafeForm } from "@/components/safe-form";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { copy, text } from "@/lib/copy";
import { itemsInPreferredOrder, moveItem } from "@/lib/question-order";
import { reorderQuestions } from "./actions";
import type { LoopQuestion } from "../loop-data";
import { PollSummary } from "./poll-summary";
import { archiveAction, skipNextAction } from "./actions";
import { ConfirmAction } from "@/components/confirm-action";
import { SubmitButton } from "@/components/submit-button";

type Question = Pick<LoopQuestion, "id" | "text" | "skipNext" | "kind" | "pollMultiple" | "pollOptions">;

export function QuestionOrder({ groupId, questions: initial }: { groupId: string; questions: Question[] }) {
  const router = useRouter();
  const [orderedIds, setOrderedIds] = useState(() => initial.map((question) => question.id));
  const items = itemsInPreferredOrder(orderedIds, initial);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [movedNote, setMovedNote] = useState("");
  const [movedId, setMovedId] = useState<string | null>(null);
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

  // A moved row can leave the screen: bring it back, mark it, and say where it went.
  useEffect(() => {
    if (!movedId) return;
    document.querySelector(`[data-row="${CSS.escape(movedId)}"]`)?.scrollIntoView({ block: "center" });
    const timer = setTimeout(() => { setMovedId(null); setMovedNote(""); }, 3200);
    return () => clearTimeout(timer);
  }, [movedId]);

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
        setMovedNote(text(copy.questions.movedVisible, {
          position: authoritative.findIndex((item) => item.id === questionId) + 1,
          total: authoritative.length,
        }));
        setMovedId(questionId);
        router.refresh();
      } catch {
        setOrderedIds(previousOrder);
        setMessage(copy.questions.orderError);
      }
    });
  }

  return (
    <>
      <ol className="mt-4 flex flex-col gap-2.5" aria-label={copy.questions.listLabel}>
        {items.map((question, index) => (
          <li key={question.id} data-row={question.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault();
            const id = draggedId.current;
            if (id) void move(id, index);
            draggedId.current = null;
          }} className={`card paper question-order-item p-4 ${pending ? "is-reordering" : ""} ${movedId === question.id ? "just-moved" : ""}`}>
            <div className="row row--wrap">
              <span className="question-number numeric">{index + 1}</span>
              <div className="min-w-0 flex-1 basis-0">
                <p className="m-0 text-[15.5px] font-bold leading-snug text-ink">{question.text}</p>
                <PollSummary question={question} />
                {question.skipNext ? <p className="m-0 mt-1 text-[13px] font-bold text-ink-soft">{copy.questions.skipNextNote}</p> : null}
              </div>
              <button type="button" draggable aria-disabled={pending ? true : undefined} data-question={question.id} data-control="handle" aria-label={text(copy.questions.moveItemLabel, { question: question.text })} title={copy.questions.dragHandle}
                onDragStart={(event) => { if (pending) { event.preventDefault(); return; } draggedId.current = question.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", question.id); }}
                onDragEnd={() => { draggedId.current = null; }} className="question-drag-handle row-icon aria-disabled:cursor-not-allowed aria-disabled:opacity-45" onClick={() => { if (!pending) setMovingId(question.id); }}>
                <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5 flex-none" fill="currentColor">{[4, 10, 16].flatMap((y) => [7, 13].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}</svg>
              </button>
              <details className="row-more">
                <summary aria-label={text(copy.questions.moreLabel, { question: question.text })} title={copy.questions.more}>
                  <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5" fill="currentColor"><circle cx="4" cy="10" r="1.8" /><circle cx="10" cy="10" r="1.8" /><circle cx="16" cy="10" r="1.8" /></svg>
                </summary>
                <div className="row-more__body">
                  <button type="button" aria-disabled={pending ? true : undefined} data-question={question.id} data-control="move" aria-label={text(copy.a11yLabels.withQuestion, { label: copy.questions.move, question: question.text })} onClick={() => { if (!pending) setMovingId(question.id); }} className="question-mobile-move btn btn-quiet h-11 min-h-11 px-3 text-[13px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45">{copy.questions.move}</button>
                  <button type="button" aria-disabled={pending || index === 0 ? true : undefined} data-question={question.id} data-control="up" aria-label={text(copy.a11yLabels.withQuestion, { label: copy.questions.up, question: question.text })} onClick={() => { if (pending || index === 0) return; refocus.current = { id: question.id, control: "up" }; void move(question.id, index - 1); }} className="question-step btn btn-quiet h-11 min-h-11 px-3 text-[13px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45">{copy.questions.up}</button>
                  <button type="button" aria-disabled={pending || index === items.length - 1 ? true : undefined} data-question={question.id} data-control="down" aria-label={text(copy.a11yLabels.withQuestion, { label: copy.questions.down, question: question.text })} onClick={() => { if (pending || index === items.length - 1) return; refocus.current = { id: question.id, control: "down" }; void move(question.id, index + 1); }} className="question-step btn btn-quiet h-11 min-h-11 px-3 text-[13px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45">{copy.questions.down}</button>
                  <SkipControl groupId={groupId} question={question} />
                  <ArchiveControl groupId={groupId} question={question} />
                </div>
              </details>
            </div>
          </li>
        ))}
      </ol>
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      {movedNote ? <p aria-hidden="true" className="toast">{movedNote}</p> : null}
      <p role="alert" className={message ? "toast toast--danger" : undefined}>{message}</p>
      <dialog ref={dialog} aria-labelledby="question-move-title" aria-describedby="question-move-description" onClose={() => setMovingId(null)} className="move-sheet">
        <div className="move-sheet-content">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="question-move-title" className="text-[20px] font-bold text-ink">{copy.questions.moveTitle}</h2>
            <button type="button" onClick={() => dialog.current?.close()} className="btn btn-quiet h-11 min-h-11 px-3 text-[13px]">{copy.common.close}</button>
          </div>
          <p id="question-move-description" className="mb-3 text-[14px] text-ink-soft">{copy.questions.moveDescription}</p>
          <div className="flex max-h-[55dvh] flex-col gap-2 overflow-y-auto">
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={pending || items[0]?.id === movingId} onClick={() => movingId && void move(movingId, 0)} className="btn btn-quiet min-h-11 flex-1 px-4 text-[14px]">{copy.questions.moveTop}</button>
              <button type="button" disabled={pending || items[items.length - 1]?.id === movingId} onClick={() => movingId && void move(movingId, items.length - 1)} className="btn btn-quiet min-h-11 flex-1 px-4 text-[14px]">{copy.questions.moveBottom}</button>
            </div>
            {items.map((question, index) => <button key={question.id} type="button" disabled={pending || question.id === movingId} aria-label={text(copy.questions.movePosition, { n: index + 1, question: question.text })}
              onClick={() => movingId && void move(movingId, index)} className="btn btn-quiet move-row min-h-12 w-full flex-none whitespace-normal px-4 py-3 text-[14px]">
              <span className="flex-none font-bold numeric">{index + 1}.</span><span className="min-w-0">{question.text}</span>
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
    <SafeForm action={skipNextAction}>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="questionId" value={question.id} />
      <SubmitButton aria-label={text(copy.a11yLabels.withQuestion, { label, question: question.text })} className="btn btn-quiet h-11 min-h-11 px-3 text-[13px]">{label}</SubmitButton>
    </SafeForm>
  );
}

function ArchiveControl({ groupId, question }: { groupId: string; question: Question }) {
  // Archiving takes the question out of the pool for good, so it asks first (WCAG 3.3.4).
  return (
    <ConfirmAction
      tone="quiet"
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
