"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { moveScrapStickerAction, peelScrapStickerAction, stickScrapSticker } from "./actions";
import { copy, text } from "@/lib/copy";
import { SCRAPBOOK_PER_ROUND, freeSpot, nudgePlacement, placementAt, type StickerPlacement } from "@/lib/looks";
import type { ScrapSticker } from "@/lib/issue-view";
import { stickerSrc } from "@/lib/stickers";

/**
 * The scrapbook layer on a delivered round: stickers in the margins of each answer.
 * One provider holds every answer's stickers, so the "left this round" count is the
 * round's, not the answer's. Writes are optimistic and spring back when refused.
 */

const words = copy.issue.scrapbook;
const stickerName = (key: string) => copy.stickers[key as keyof typeof copy.stickers] ?? key;

type Placed = ScrapSticker & { pending?: boolean; fresh?: boolean };

type Scrapbook = {
  issueId: string;
  canStick: boolean;
  canModerate: boolean;
  left: number;
  stickersOn: (replyId: string) => Placed[];
  stick: (replyId: string, sticker: string, reserved: StickerPlacement[]) => void;
  /** Says there are none left, where the viewer asked for one. */
  spent: (replyId: string) => void;
  move: (replyId: string, id: string, placement: StickerPlacement) => void;
  peel: (replyId: string, id: string) => void;
  note: (replyId: string) => { text: string; error: boolean } | null;
  leftLine: (left: number) => string;
};

const ScrapbookContext = createContext<Scrapbook | null>(null);

/** The page's body never changes; this only tells the server render from the browser's. */
const subscribeToNothing = () => () => {};

/** The round's scrapbook, or null where there's none (an open round). */
export function useScrapbook(): Scrapbook | null {
  return useContext(ScrapbookContext);
}

export type ScrapbookSetup = {
  /** Anyone in the loop who can read the round; nobody on a share link. */
  canStick: boolean;
  /** The owner and admins, who can peel off anyone's. */
  canModerate: boolean;
  /** How many the viewer has stuck around this round, answers they can't see included. */
  used: number;
};

const leftLine = (left: number) => (left === 1 ? words.leftOne : left > 1 ? text(words.left, { count: left }) : text(words.spent, { limit: SCRAPBOOK_PER_ROUND }));

export function ScrapbookProvider({
  issueId,
  viewerToken,
  setup,
  initial,
  children,
}: {
  issueId: string;
  viewerToken: string | null;
  setup: ScrapbookSetup;
  /** Every answer's stickers as the page loaded, by reply. */
  initial: Record<string, ScrapSticker[]>;
  children: ReactNode;
}) {
  const [stickers, setStickers] = useState<Record<string, Placed[]>>(initial);
  const [notes, setNotes] = useState<Record<string, { text: string; error: boolean }>>({});
  // One live region for the page, kept outside the round itself so it adds nothing to it.
  const [heard, setHeard] = useState({ text: "", count: 0 });
  const live = useSyncExternalStore(subscribeToNothing, () => document.body, () => null);
  const temp = useRef(0);
  // Stickers of yours on answers this page doesn't show still count against you.
  const [elsewhere] = useState(() => Math.max(0, setup.used - Object.values(initial).flat().filter((one) => one.mine).length));
  const used = elsewhere + Object.values(stickers).flat().filter((one) => one.mine).length;
  const left = Math.max(0, SCRAPBOOK_PER_ROUND - used);

  const say = useCallback((replyId: string, message: string, error = false) => {
    setNotes((all) => ({ ...all, [replyId]: { text: message, error } }));
    // The same words twice ("Moved.") still change the region, so they're said again.
    setHeard((before) => ({ text: message, count: before.count + 1 }));
  }, []);
  const update = useCallback((replyId: string, change: (list: Placed[]) => Placed[]) => {
    setStickers((all) => ({ ...all, [replyId]: change(all[replyId] ?? []) }));
  }, []);

  const value = useMemo<Scrapbook>(() => ({
    issueId,
    canStick: setup.canStick,
    canModerate: setup.canModerate,
    left,
    stickersOn: (replyId) => stickers[replyId] ?? [],
    note: (replyId) => notes[replyId] ?? null,
    leftLine,
    spent: (replyId) => say(replyId, leftLine(0)),
    stick(replyId, sticker, reserved) {
      if (left <= 0) return say(replyId, leftLine(0));
      const placement = freeSpot(stickers[replyId] ?? [], Math.random, reserved);
      const id = `pending-${++temp.current}`;
      update(replyId, (list) => [...list, { id, sticker, ...placement, by: "", mine: true, pending: true, fresh: true }]);
      stickScrapSticker({ issueId, replyId, sticker, placement, viewerToken })
        .then((result) => {
          if (!result.ok) {
            update(replyId, (list) => list.filter((one) => one.id !== id));
            say(replyId, result.error, true);
            return;
          }
          update(replyId, (list) => list.map((one) => (one.id === id ? { ...one, ...result.sticker, pending: false } : one)));
          say(replyId, text(words.stuck, { sticker: stickerName(sticker), left: leftLine(left - 1) }));
        })
        .catch(() => {
          update(replyId, (list) => list.filter((one) => one.id !== id));
          say(replyId, words.errors.failed, true);
        });
    },
    move(replyId, id, placement) {
      const before = (stickers[replyId] ?? []).find((one) => one.id === id);
      if (!before) return;
      update(replyId, (list) => list.map((one) => (one.id === id ? { ...one, ...placement, fresh: false } : one)));
      const springBack = (message: string) => {
        update(replyId, (list) => list.map((one) => (one.id === id ? { ...one, side: before.side, offset: before.offset, tilt: before.tilt } : one)));
        say(replyId, message, true);
      };
      moveScrapStickerAction({ issueId, stickerId: id, placement, viewerToken })
        .then((result) => {
          if (!result.ok) springBack(result.error);
          else say(replyId, words.moved);
        })
        .catch(() => springBack(words.errors.failed));
    },
    peel(replyId, id) {
      const list = stickers[replyId] ?? [];
      const index = list.findIndex((one) => one.id === id);
      if (index < 0) return;
      const gone = list[index];
      update(replyId, (all) => all.filter((one) => one.id !== id));
      const putBack = (message: string) => {
        update(replyId, (all) => (all.some((one) => one.id === id) ? all : [...all.slice(0, index), gone, ...all.slice(index)]));
        say(replyId, message, true);
      };
      peelScrapStickerAction({ issueId, stickerId: id, viewerToken })
        .then((result) => {
          if (!result.ok) return putBack(result.error);
          say(replyId, gone.mine
            ? text(words.peeled, { left: leftLine(Math.min(SCRAPBOOK_PER_ROUND, left + 1)) })
            : text(words.peeledTheirs, { name: gone.by, sticker: stickerName(gone.sticker) }));
        })
        .catch(() => putBack(words.errors.failed));
    },
  }), [issueId, viewerToken, setup.canStick, setup.canModerate, left, stickers, notes, say, update]);

  return (
    <ScrapbookContext.Provider value={value}>
      {children}
      {live ? createPortal(<p aria-live="polite" className="sr-only">{heard.text}{heard.count % 2 ? "\u00a0" : ""}</p>, live) : null}
    </ScrapbookContext.Provider>
  );
}

/** What just happened to this answer's stickers, shown where it happened (the page's live region says it too). */
export function ScrapNote({ replyId }: { replyId: string }) {
  const note = useScrapbook()?.note(replyId) ?? null;
  if (!note) return null;
  return <p className={`scrap-note${note.error ? " text-danger" : ""}`}>{note.text}</p>;
}

/**
 * The stickers in one answer's margins. Sits over the answer's own box, as wide as
 * its card, and only the stickers take pointers: nothing under the words is blocked.
 */
export function ScrapLayer({ replyId }: { replyId: string }) {
  const book = useScrapbook();
  const layer = useRef<HTMLDivElement>(null);
  const list = book?.stickersOn(replyId) ?? [];
  if (!book || list.length === 0) return null;
  return (
    <div ref={layer} className="scrap-layer">
      {list.map((one) => (
        <ScrapStickerButton key={one.id} replyId={replyId} sticker={one} layer={layer} />
      ))}
    </div>
  );
}

const DRAG_START = 6;

function ScrapStickerButton({ replyId, sticker, layer }: { replyId: string; sticker: Placed; layer: RefObject<HTMLDivElement | null> }) {
  const book = useScrapbook()!;
  const [menu, setMenu] = useState(false);
  const [tag, setTag] = useState(false);
  const [live, setLive] = useState<StickerPlacement | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null);
  const dragged = useRef(false);
  const menuId = useId();
  const name = stickerName(sticker.sticker);
  const who = sticker.mine ? words.stuckByYou : text(words.stuckBy, { name: sticker.by });
  const canMove = sticker.mine && !sticker.pending;
  const canPeel = !sticker.pending && (sticker.mine || book.canModerate);
  const at = live ?? sticker;

  // A click or tap anywhere else, or Escape, puts the menu away.
  useEffect(() => {
    if (!menu) return;
    const away = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setMenu(false);
    };
    // Safari doesn't focus a button it clicks, so after a move focus can be back on the
    // page rather than in the menu, where the menu's own Escape wouldn't hear it.
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenu(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  useEffect(() => {
    if (!tag) return;
    const timer = window.setTimeout(() => setTag(false), 2400);
    return () => window.clearTimeout(timer);
  }, [tag]);

  const place = (placement: StickerPlacement) => book.move(replyId, sticker.id, placement);
  const peel = () => {
    setMenu(false);
    book.peel(replyId, sticker.id);
    document.getElementById(`react-${replyId}`)?.focus();
  };

  function down(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!canMove || event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, moved: false, id: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveTo(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    if (!state.moved && Math.hypot(event.clientX - state.x, event.clientY - state.y) < DRAG_START) return;
    state.moved = true;
    setMenu(false);
    const box = layer.current?.getBoundingClientRect();
    if (!box) return;
    setLive(placementAt({ x: event.clientX, y: event.clientY }, box, event.currentTarget.offsetHeight, sticker.tilt));
  }
  function up(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    drag.current = null;
    if (!state || state.id !== event.pointerId || !state.moved) return;
    dragged.current = true;
    if (live && (live.side !== sticker.side || live.offset !== sticker.offset)) place(live);
    setLive(null);
  }
  function cancel() {
    drag.current = null;
    setLive(null);
  }
  function keys(event: KeyboardEvent<HTMLButtonElement>) {
    if (!canMove) return;
    const move = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: sticker.side === "right" ? "swap" : null, ArrowRight: sticker.side === "left" ? "swap" : null }[event.key];
    if (move === undefined) return;
    event.preventDefault();
    if (move) place(nudgePlacement(sticker, move as "up" | "down" | "swap"));
  }

  const style = { "--offset": at.offset / 100, "--tilt": `${at.tilt}deg` } as CSSProperties;
  const label = sticker.mine
    ? text(words.labelYours, { sticker: name })
    : book.canModerate
      ? text(words.labelModerate, { sticker: name, name: sticker.by })
      : text(words.label, { sticker: name, name: sticker.by });

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`scrap-sticker scrap-sticker--${at.side}${sticker.mine ? " is-mine" : ""}${live ? " is-dragging" : ""}${sticker.fresh ? " scrap-sticker--pop" : ""}${tag ? " is-told" : ""}`}
        style={style}
        data-sticker={sticker.sticker}
        data-side={at.side}
        data-offset={at.offset}
        aria-label={label}
        aria-haspopup={canPeel ? "true" : undefined}
        aria-expanded={canPeel ? menu : undefined}
        aria-controls={menu ? menuId : undefined}
        aria-disabled={sticker.pending ? true : undefined}
        onPointerDown={down}
        onPointerMove={moveTo}
        onPointerUp={up}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={keys}
        onClick={() => {
          // The click that ends a drag isn't a tap.
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          if (canPeel) setMenu((open) => !open);
          else setTag((shown) => !shown);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- A tiny static drawing. */}
        <img src={stickerSrc(sticker.sticker)} alt="" width={52} height={52} draggable={false} />
        <span className="scrap-sticker__tag" aria-hidden="true">{who}</span>
      </button>
      {menu ? (
        <div
          ref={menuRef}
          id={menuId}
          role="group"
          aria-label={text(words.menuLabel, { sticker: name, name: sticker.mine ? copy.issue.you : sticker.by })}
          className={`scrap-menu scrap-menu--${at.side}${at.offset > 50 ? " scrap-menu--up" : ""}`}
          style={style}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            setMenu(false);
            button.current?.focus();
          }}
        >
          <p className="scrap-menu__who">{who}</p>
          {canMove ? (
            <>
              {/* aria-disabled at the ends, so a press that reaches one keeps its focus. */}
              <button type="button" aria-disabled={sticker.offset <= 0 ? true : undefined} onClick={() => sticker.offset > 0 && place(nudgePlacement(sticker, "up"))}>{words.moveUp}</button>
              <button type="button" aria-disabled={sticker.offset >= 100 ? true : undefined} onClick={() => sticker.offset < 100 && place(nudgePlacement(sticker, "down"))}>{words.moveDown}</button>
              <button type="button" onClick={() => place(nudgePlacement(sticker, "swap"))}>{sticker.side === "left" ? words.swapRight : words.swapLeft}</button>
            </>
          ) : null}
          <button type="button" className="scrap-menu__peel" onClick={peel}>{words.peel}</button>
          <button type="button" className="scrap-menu__done" onClick={() => { setMenu(false); button.current?.focus(); }}>{words.done}</button>
        </div>
      ) : null}
    </>
  );
}
