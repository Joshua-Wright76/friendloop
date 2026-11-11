"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { wrapTab } from "./focus-wrap";
import { copy, text } from "@/lib/copy";
import { postReply } from "@/lib/reply-client";
import { CHARM_KEYS, stickerSrc } from "@/lib/stickers";

const nameOf = (key: string) => copy.stickers[key as keyof typeof copy.stickers] ?? key;

/**
 * The sticker sheet, as a bottom sheet on a phone and a centred card elsewhere. A
 * native modal dialog: focus moves in and stays, Escape or a tap outside closes it,
 * and focus goes back to the button that opened it. The current sticker is pressed;
 * tapping it again, or None, peels it off.
 */
export function StickerSheet({
  current,
  opener,
  onPick,
  onClose,
  title = copy.reply.sticker.sheetTitle,
  note = copy.reply.sticker.sheetNote,
  extra,
  withNone = true,
}: {
  current: string | null;
  /** The button that opened it. Safari doesn't focus a button it clicks, so this can't be read off the page. */
  opener: RefObject<HTMLElement | null>;
  onPick: (key: string | null) => void;
  onClose: () => void;
  title?: string;
  note?: string;
  /** A line under the note, like how many are left. */
  extra?: string;
  /** The None cell, for peeling off the one sticker an answer carries. */
  withNone?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const noteId = useId();

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    // React takes the dialog off the page before this cleanup runs, so focus goes back by hand.
    const back = opener.current;
    node.showModal();
    (node.querySelector<HTMLButtonElement>("[aria-pressed=true]") ?? first.current)?.focus();
    return () => {
      node.close();
      back?.focus();
    };
  }, [opener]);

  return (
    <dialog
      ref={dialog}
      className="sticker-picker"
      aria-labelledby={titleId}
      aria-describedby={noteId}
      // No onClose: the cleanup below closes the dialog, and its late close event must not
      // close the next one. Escape, a tap outside and Close are the ways out.
      onKeyDown={wrapTab}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="sticker-picker__panel">
        <span className="sticker-picker__grab" aria-hidden="true" />
        <div className="sticker-picker__head">
          <h2 id={titleId} className="sticker-picker__title">{title}</h2>
          <button type="button" className="link link--quiet min-h-11 min-w-11 cursor-pointer justify-center px-2 text-[14px] font-bold" onClick={onClose}>{copy.common.close}</button>
        </div>
        <p id={noteId} className="sticker-picker__note">{note}{extra ? <strong className="sticker-picker__extra">{extra}</strong> : null}</p>
        <div className="sticker-picker__grid">
          {withNone ? (
            <button ref={first} type="button" className="sticker-picker__cell sticker-picker__cell--none" aria-pressed={current === null} onClick={() => onPick(null)}>
              {copy.reply.sticker.none}
            </button>
          ) : null}
          {CHARM_KEYS.map((key, index) => (
            <button
              key={key}
              ref={!withNone && index === 0 ? first : undefined}
              type="button"
              className="sticker-picker__cell"
              aria-pressed={current === key}
              aria-label={nameOf(key)}
              onClick={() => onPick(current === key ? null : key)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- A tiny static drawing; there is nothing for the image optimiser to do. */}
              <img src={stickerSrc(key)} alt="" width={44} height={44} loading="lazy" />
            </button>
          ))}
        </div>
      </div>
    </dialog>
  );
}

/**
 * "＋ Sticker" under one answer on the reply sheet: opens the sheet, sticks the pick on
 * straight away (with a little pop) and saves it with the answer. It waits until the
 * card has an answer, and says so if tapped before.
 */
export function StickerControl({
  token,
  questionId,
  initial,
  answered,
  disabled = false,
  forQuestion,
  track,
}: {
  token: string;
  questionId: string;
  initial: string | null;
  /** Whether the card has anything in it yet. */
  answered: boolean;
  disabled?: boolean;
  /** Names a control after its card, so every card's button is told apart. */
  forQuestion: (label: string) => string;
  /** Lets Done wait for a save still on its way. */
  track?: (save: Promise<unknown>) => void;
}) {
  const [sticker, setSticker] = useState(initial);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [popped, setPopped] = useState(0);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const confirmed = useRef(initial);
  const revision = useRef(0);

  function choose(next: string | null) {
    setOpen(false);
    if (next === sticker) return;
    const mine = ++revision.current;
    setSticker(next);
    setPopped((count) => count + 1);
    setMessage({ text: next ? text(copy.reply.sticker.stuck, { sticker: nameOf(next) }) : copy.reply.sticker.peeled, error: false });
    const save = postReply(token, { action: "sticker", issueQuestionId: questionId, sticker: next ?? "" }, copy.reply.sticker.error).then((result) => {
      if (revision.current !== mine) return;
      if (result.ok) {
        confirmed.current = next;
      } else {
        setSticker(confirmed.current);
        setMessage({ text: result.error, error: true });
      }
    });
    track?.(save);
  }

  const blocked = disabled || !answered;
  return (
    <div className="sticker-control">
      {sticker ? (
        // Decoration: the live line below says what was stuck on.
        // eslint-disable-next-line @next/next/no-img-element -- A tiny static drawing; there is nothing for the image optimiser to do.
        <img key={popped} src={stickerSrc(sticker)} alt="" aria-hidden="true" width={40} height={40} className={`stuck-sticker${popped > 0 ? " stuck-sticker--pop" : ""}`} />
      ) : null}
      <button
        ref={button}
        type="button"
        className="attach-btn sticker-btn aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
        aria-haspopup="dialog"
        aria-disabled={blocked ? true : undefined}
        aria-label={forQuestion(sticker ? copy.reply.sticker.change : copy.reply.sticker.addLabel)}
        onClick={() => {
          if (disabled) return;
          if (!answered) {
            setMessage({ text: copy.reply.sticker.needsAnswer, error: false });
            return;
          }
          setMessage(null);
          setOpen(true);
        }}
      >
        {sticker ? null : <svg viewBox="0 0 20 20" aria-hidden="true" className="attach-btn__icon"><path d="M10 4v12M4 10h12" /></svg>}
        {sticker ? copy.reply.sticker.change : copy.reply.sticker.add}
      </button>
      <p aria-live="polite" className={message ? `sticker-control__note${message.error ? " text-danger" : ""}` : "sr-only"}>{message?.text}</p>
      {open ? <StickerSheet current={sticker} opener={button} onPick={choose} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
