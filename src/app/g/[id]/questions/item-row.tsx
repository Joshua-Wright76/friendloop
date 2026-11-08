"use client";

import { useId, useState, type ReactNode } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { SafeForm } from "@/components/safe-form";
import { SubmitButton } from "@/components/submit-button";
import { copy, text } from "@/lib/copy";
import type { AnswerFormat } from "@/lib/asks";
import type { PageItem } from "../loop-data";
import { askThisRoundAction, stopAskingAction, updateItemAction } from "./actions";
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
export function ItemRow({ item, groupId, number, tag, inThisRound, manages, poll }: {
  item: PageItem;
  groupId: string;
  number?: number;
  /** When it comes up: its round, or its next date. */
  tag?: string | null;
  inThisRound: boolean;
  manages: boolean;
  /** Its options in a line, when it's a poll. */
  poll?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const editorId = useId();
  const tags = itemTags(item);
  const body = (
    <>
      {number !== undefined ? <span className="question-number numeric" aria-hidden="true">{number}</span> : null}
      <span className="item-main">
        <ItemLabel emoji={item.emoji} label={item.label} />
        {tags || tag ? (
          <span className="item-meta numeric">
            {[tags, tag].filter(Boolean).join(" · ")}
          </span>
        ) : null}
        {poll}
      </span>
    </>
  );

  if (!manages) return <div className="item-row">{body}</div>;
  return (
    <div className="item-row-wrap">
      <button
        type="button"
        className="item-row item-row--button"
        aria-expanded={open}
        aria-controls={editorId}
        aria-label={text(copy.questions.item.editLabel, { item: item.label })}
        onClick={() => setOpen((current) => !current)}
      >
        {body}
        <svg viewBox="0 0 20 20" aria-hidden="true" className="item-chevron">
          <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div id={editorId} hidden={!open}>
        {open ? <ItemEditor item={item} groupId={groupId} inThisRound={inThisRound} /> : null}
      </div>
    </div>
  );
}

/** The editor a row opens: the item's fields, and what can be done with it. */
export function ItemEditor({ item, groupId, inThisRound }: { item: PageItem; groupId: string; inThisRound: boolean }) {
  return (
    <div className="item-editor">
      <SafeForm action={updateItemAction} className="flex flex-col gap-3">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="questionId" value={item.id} />
        <ItemFields item={item} defaultFrequency={item.frequency} />
        <div>
          <SubmitButton className="btn btn-primary min-h-11 px-5 text-[14px]">{copy.questions.item.save}</SubmitButton>
        </div>
      </SafeForm>
      <div className="item-editor__actions">
        {item.frequency === "on_date" ? null : inThisRound ? (
          <p className="m-0 self-center text-[13px] font-bold text-ink-soft">{copy.questions.upNext.inThisRound}</p>
        ) : (
          <SafeForm action={askThisRoundAction}>
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="questionId" value={item.id} />
            <SubmitButton aria-label={text(copy.questions.upNext.askNowLabel, { item: item.label })} className="btn btn-quiet min-h-11 px-4 text-[14px]">
              {copy.questions.upNext.askNow}
            </SubmitButton>
          </SafeForm>
        )}
        <ConfirmAction
          tone="quiet"
          action={stopAskingAction}
          fields={{ groupId, questionId: item.id }}
          label={copy.questions.item.stop}
          triggerLabel={text(copy.questions.item.stopLabel, { item: item.label })}
          question={text(copy.questions.item.stopQuestion, { item: item.label })}
          body={copy.questions.item.stopBody}
          confirmLabel={copy.questions.item.stopConfirm}
          cancelLabel={copy.a11yLabels.confirmCancel}
        />
      </div>
    </div>
  );
}
