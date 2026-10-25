"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { copy, text } from "@/lib/copy";
import { itemsInPreferredOrder, moveItem } from "@/lib/question-order";
import { reorderQuestions } from "./actions";
import { archiveAction, skipNextAction } from "./actions";

type Question = { id: string; text: string; skipNext: boolean };

export function QuestionOrder({ groupId, questions: initial }: { groupId: string; questions: Question[] }) {
  const [orderedIds, setOrderedIds] = useState(() => initial.map((question) => question.id));
  const items = itemsInPreferredOrder(orderedIds, initial);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const draggedId = useRef<string | null>(null);

  useEffect(() => {
    if (movingId) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [movingId]);

  async function move(questionId: string, targetIndex: number) {
    const previousOrder = items.map((item) => item.id);
    const sourceIndex = items.findIndex((item) => item.id === questionId);
    if (sourceIndex < 0 || targetIndex === sourceIndex) return;
    const next = moveItem(items, sourceIndex, targetIndex);
    setOrderedIds(next.map((item) => item.id));
    setMessage("");
    setMovingId(null);
    startTransition(async () => {
      try {
        const authoritative = await reorderQuestions(groupId, questionId, targetIndex);
        setOrderedIds(authoritative.map((item) => item.id));
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
                {question.skipNext ? <p className="mt-1 text-[12px] font-medium text-ink-muted">{copy.questions.skipNextNote}</p> : null}
              </div>
              <button type="button" draggable disabled={pending} aria-label={text(copy.questions.moveItemLabel, { question: question.text })} title={copy.questions.dragHandle}
                onDragStart={(event) => { draggedId.current = question.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", question.id); }}
                onDragEnd={() => { draggedId.current = null; }} className="question-drag-handle btn btn-quiet h-10 w-10 min-h-10 p-0" onClick={() => setMovingId(question.id)}>
                <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5"><path d="M7 4h.01M13 4h.01M7 10h.01M13 10h.01M7 16h.01M13 16h.01" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
              </button>
            </div>
            <div className="question-order-controls mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={pending || index === 0} onClick={() => void move(question.id, index - 1)} className="question-step btn btn-quiet h-10 px-3 text-[13px]">{copy.questions.up}</button>
              <button type="button" disabled={pending || index === items.length - 1} onClick={() => void move(question.id, index + 1)} className="question-step btn btn-quiet h-10 px-3 text-[13px]">{copy.questions.down}</button>
              <button type="button" disabled={pending} onClick={() => setMovingId(question.id)} className="question-mobile-move btn btn-quiet h-10 px-3 text-[13px]">{copy.questions.move}</button>
              <SkipControl groupId={groupId} question={question} />
              <ArchiveControl groupId={groupId} questionId={question.id} />
            </div>
          </li>
        ))}
      </ol>
      {message ? <p role="status" className="mt-3 text-[14px] text-danger">{message}</p> : null}
      <dialog ref={dialog} aria-labelledby="question-move-title" aria-describedby="question-move-description" onClose={() => setMovingId(null)} className="move-sheet">
        <div className="move-sheet-content">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="question-move-title" className="text-[20px] font-bold text-ink">{copy.questions.moveTitle}</h2>
            <button type="button" onClick={() => dialog.current?.close()} className="btn btn-quiet h-10 px-3 text-[13px]">{copy.common.close}</button>
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
  return <form action={skipNextAction}><input type="hidden" name="groupId" value={groupId} /><input type="hidden" name="questionId" value={question.id} /><button type="submit" className="btn btn-quiet h-10 px-3 text-[13px]">{question.skipNext ? copy.questions.backIn : copy.questions.skipNext}</button></form>;
}

function ArchiveControl({ groupId, questionId }: { groupId: string; questionId: string }) {
  return <form action={archiveAction}><input type="hidden" name="groupId" value={groupId} /><input type="hidden" name="questionId" value={questionId} /><button type="submit" className="btn btn-quiet h-10 px-3 text-[13px] text-danger">{copy.questions.archive}</button></form>;
}

