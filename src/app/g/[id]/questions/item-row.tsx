"use client";

import { useId, useState, type ReactNode } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { SafeForm } from "@/components/safe-form";
import { SubmitButton } from "@/components/submit-button";
import { copy, text } from "@/lib/copy";
import type { AnswerFormat } from "@/lib/asks";
import type { PageItem } from "../loop-data";
import { askThisRoundAction, removeFromRoundAction, stopAskingAction, updateItemAction } from "./actions";
import { ItemFields } from "./item-fields";

/** "Poll · Owner and admins": what kind of item this is, in a few words. */
export function itemTags(item: { format: AnswerFormat; adminOnly: boolean }, extra: Array<string | null> = []): string {
  return [
    item.format === "written" ? null : copy.questions.item.formats[item.format],
    item.adminOnly ? copy.questions.item.adminOnlyTag : null,
    ...extra,
  ].filter(Boolean).join(" · ");
}

/** An item's emoji and words, as a row shows them. */
export function ItemLabel({ emoji, label }: { emoji: string | null; label: string }) {
  return (
    <span className="item-label">
      {emoji ? <span className="item-emoji" aria-hidden="true">{emoji}</span> : null}
      <span className="min-w-0">{label}</span>
    </span>
  );
}

/**
 * One row of the loop's list. Tapping it opens it in place: everything it is,
 * Save, Stop asking, and, for one that isn't in this round, Ask this round too.
 */
export function ItemRow({ item, groupId, number, tag, inThisRound, manages, poll, anchorId, notice, action }: {
  item: PageItem;
  groupId: string;
  number?: number;
  /** When it comes up: its round, or its next date. */
  tag?: string | null;
  inThisRound: boolean;
  manages: boolean;
  /** Its options in a line, when it's a poll. */
  poll?: ReactNode;
  /** The id the page scrolls to after a change to this row. */
  anchorId?: string;
  /** A confirmation for a change made here, shown right under the row. */
  notice?: ReactNode;
  /** A one-tap action under the row, such as "Add to this round"; the editor then leaves it out. */
  action?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const editorId = useId();
  const tags = itemTags(item);
  // One quiet line; "In this round" is its own small chip, so it is never read as part of the dates.
  // In this round, that is the whole answer to "when": no second, later round beside it.
  const meta = [tags, inThisRound ? null : tag].filter(Boolean).join(" \u00b7 ");
  const body = (
    <>
      {number !== undefined ? <span className="question-number numeric" aria-hidden="true">{number}</span> : null}
      <span className="item-main">
        <ItemLabel emoji={item.emoji} label={item.label} />
        {meta ? <span className="item-meta numeric">{meta}</span> : null}
        {poll}
        {inThisRound ? <span className="now-chip">{copy.questions.upNext.inThisRound}</span> : null}
      </span>
    </>
  );

  if (!manages) return <div id={anchorId} className="item-row">{body}</div>;
  return (
    <div id={anchorId} className="item-row-wrap">
      <button
        type="button"
        className="item-row item-row--button"
        aria-expanded={open}
        aria-controls={editorId}
        onClick={() => setOpen((current) => !current)}
      >
        {/* Named by what it shows (WCAG 2.5.3), after a word that says what tapping does. */}
        <span className="sr-only">{copy.questions.item.editPrefix} </span>
        {body}
        <svg viewBox="0 0 20 20" aria-hidden="true" className="item-chevron">
          <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {action ? <div className="row-add">{action}</div> : null}
      <div id={editorId} hidden={!open}>
        {open ? <ItemEditor item={item} groupId={groupId} inThisRound={inThisRound || Boolean(action)} /> : null}
      </div>
      {notice}
    </div>
  );
}

/** "Add to this round", one tap, for a question that isn't in it. */
export function AskNowButton({ item, groupId }: { item: PageItem; groupId: string }) {
  if (item.frequency === "on_date") return null;
  return (
    <SafeForm action={askThisRoundAction} className="inline-flex">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="questionId" value={item.id} />
      <SubmitButton aria-label={text(copy.questions.upNext.askNowLabel, { item: item.label })} className="btn btn-quiet min-h-11 px-4 text-[14px]">
        <span aria-hidden="true" className="mr-1.5">+</span>{copy.questions.upNext.askNow}
      </SubmitButton>
    </SafeForm>
  );
}

/** The editor a row opens: the item's fields, and what can be done with it. */
export function ItemEditor({ item, groupId, inThisRound, hideStop = false, steps }: { item: PageItem; groupId: string; inThisRound: boolean; /** Move buttons for a row of the round's list. */ steps?: ReactNode; /** The row has its own Remove choice, which already offers Stop asking. */ hideStop?: boolean }) {
  return (
    <div className="item-editor">
      {steps}
      <div className="item-editor__actions">
        {item.frequency === "on_date" || inThisRound ? null : (
          <SafeForm action={askThisRoundAction}>
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="questionId" value={item.id} />
            <SubmitButton aria-label={text(copy.questions.upNext.askNowLabel, { item: item.label })} className="btn btn-quiet min-h-11 px-4 text-[14px]">
              {copy.questions.upNext.askNow}
            </SubmitButton>
          </SafeForm>
        )}
        {hideStop ? null : <ConfirmAction
          tone="quiet"
          action={stopAskingAction}
          fields={{ groupId, questionId: item.id }}
          label={copy.questions.item.stop}
          triggerLabel={text(copy.questions.item.stopLabel, { item: item.label })}
          question={text(copy.questions.item.stopQuestion, { item: item.label })}
          body={copy.questions.item.stopBody}
          confirmLabel={copy.questions.item.stopConfirm}
          cancelLabel={copy.a11yLabels.confirmCancel}
        />}
      </div>
      <SafeForm action={updateItemAction} className="flex flex-col gap-3">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="questionId" value={item.id} />
        <ItemFields item={item} defaultFrequency={item.frequency} />
        <div>
          <SubmitButton className="btn btn-primary min-h-11 px-5 text-[14px]">{copy.questions.item.save}</SubmitButton>
        </div>
      </SafeForm>
    </div>
  );
}

/**
 * One way to take a question out: a Remove button that opens a small choice, "Skip this round"
 * or "Stop asking", each with a few words on what it does. Both are undoable.
 */
export function RemovePanel({ groupId, questionId, snapshotId, label, turn, canSkip, onClose }: {
  groupId: string;
  questionId: string | null;
  snapshotId: string | null;
  label: string;
  turn: boolean;
  canSkip: boolean;
  onClose: () => void;
}) {
  const m = copy.questions.thisRound.menu;
  return (
    <div role="group" aria-label={text(m.openLabel, { item: label })} className="remove-panel">
      <ul className="remove-panel__choices">
        {canSkip && snapshotId ? (
          <li>
            <SafeForm action={removeFromRoundAction}>
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="snapshotId" value={snapshotId} />
              {questionId ? <input type="hidden" name="questionId" value={questionId} /> : null}
              <input type="hidden" name="turn" value={turn ? "1" : "0"} />
              <SubmitButton aria-label={text(m.skipLabel, { item: label })} className="btn btn-quiet min-h-11 px-4 text-[14px]">{m.skip}</SubmitButton>
            </SafeForm>
            <p>{m.skipHint}</p>
          </li>
        ) : null}
        {questionId ? (
          <li>
            <SafeForm action={stopAskingAction}>
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="questionId" value={questionId} />
              <SubmitButton aria-label={text(copy.questions.item.stopLabel, { item: label })} className="btn btn-quiet min-h-11 px-4 text-[14px]">{m.stop}</SubmitButton>
            </SafeForm>
            <p>{m.stopHint}</p>
          </li>
        ) : null}
      </ul>
      <button type="button" className="link link--quiet min-h-11" onClick={onClose}>{m.close}</button>
    </div>
  );
}
