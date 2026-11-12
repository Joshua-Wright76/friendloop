"use client";

import { DialogClose } from "@/components/dialog-close";
import { wrapTab } from "./focus-wrap";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { copy } from "@/lib/copy";
import { CHARM_KEYS, stickerSrc } from "@/lib/stickers";

/** One line of `public/emoji-picker.json`: the emoji, its name, group, search words, and five skin tones if it has them. */
type Entry = { e: string; n: string; g: string; t: string; s?: string[] };

const RECENT_KEY = "friendloop:recent-emoji";
const TONE_KEY = "friendloop:emoji-tone";
const MAX_RECENT = 16;
const GROUPS = ["smileys", "people", "nature", "food", "travel", "activities", "objects", "symbols", "flags"] as const;

// Fetched once, on first open, then shared: it's a couple of hundred kilobytes nobody needs until they want it.
let list: Promise<Entry[]> | null = null;
function loadEmoji(): Promise<Entry[]> {
  list ??= fetch("/emoji-picker.json")
    .then((response) => {
      if (!response.ok) throw new Error("emoji list unavailable");
      return response.json() as Promise<{ emoji: Entry[] }>;
    })
    .then((data) => data.emoji)
    .catch((error: unknown) => {
      list = null;
      throw error;
    });
  return list;
}

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing: the picker just doesn't remember.
  }
}

/** Whatever a phone's own emoji keyboard typed into the search box counts as a pick. */
function typedEmoji(query: string): string | null {
  const value = query.trim();
  if (!value) return null;
  try {
    return new RegExp("^\\p{RGI_Emoji}$", "v").test(value) ? value : null;
  } catch {
    return null;
  }
}

function searchable(entry: Entry, words: string[]): boolean {
  const haystack = `${entry.n} ${entry.t}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** How well a name fits the search: 0 exact, 1 starts with it, 2 every word starts a word of the name, 3 anything else that matched. */
function matchRank(entry: Entry, words: string[]): number {
  const name = entry.n.toLowerCase();
  const query = words.join(" ");
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  const nameWords = name.split(/[\s:_-]+/);
  if (words.every((word) => nameWords.some((part) => part.startsWith(word)))) return 2;
  return 3;
}

/** Best matches first; within a rank, the list's own order, so results never shuffle between keystrokes. */
function ranked(entries: Entry[], words: string[]): Entry[] {
  return entries
    .filter((entry) => searchable(entry, words))
    .map((entry, index) => ({ entry, index, rank: matchRank(entry, words) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.entry);
}

/**
 * Any emoji at all, searchable. A native dialog, so focus stays inside, Escape closes
 * it and focus goes back to the button that opened it. It's a bottom sheet on a phone
 * and a centred card elsewhere. Arrow keys move through the grid, so tabbing doesn't
 * mean walking through two thousand buttons.
 */
export function EmojiPicker({ label, opener, heading, quick, stickers, onPick, onClose }: { label: string; /** The button that opened it. Safari doesn't focus a button it clicks, so this can't be read off the page. */ opener: RefObject<HTMLElement | null>; /** Adds a Stickers tab: reactions and stickers are one idea. */ stickers?: { onPick: (key: string) => void; /** A line like how many stickers are left. */ note?: string };  /** A first row of one-tap picks, shown before anything is searched. */ quick?: readonly string[]; /** A short visible title; the long label stays for assistive tech. */ heading?: string; onPick: (emoji: string) => void; onClose: () => void }) {
  const tabsId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [tab, setTab] = useState<"emoji" | "stickers">("emoji");
  const onStickers = Boolean(stickers) && tab === "stickers";

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    // React takes the dialog off the page before this cleanup runs, and a dialog that's
    // already gone can't hand focus back on its own, so it's done by hand.
    const back = opener.current;
    node.showModal();
    // On a phone, opening the keyboard would hide the very grid someone came to browse.
    if (window.matchMedia("(pointer: fine)").matches) search.current?.focus();
    return () => {
      node.close();
      back?.focus();
    };
  }, [opener]);

  useEffect(() => {
    let live = true;
    loadEmoji()
      .then((loaded) => {
        if (live) setEntries(loaded);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  useEffect(() => {
    // Read after mount: the server has no idea what you used last.
    setRecent((stored(RECENT_KEY) ?? "").split(" ").filter(Boolean));
    setTone(Math.min(5, Math.max(0, Number(stored(TONE_KEY)) || 0)));
  }, []);

  const toned = (entry: Entry) => (tone > 0 && entry.s ? entry.s[tone - 1] : entry.e);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = useMemo(() => {
    if (!entries || words.length === 0) return null;
    return ranked(entries, words);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `words` is rebuilt from `query` every render.
  }, [entries, query]);
  const typed = typedEmoji(query);

  function pick(emoji: string) {
    store(RECENT_KEY, [emoji, ...recent.filter((item) => item !== emoji)].slice(0, MAX_RECENT).join(" "));
    onPick(emoji);
  }

  function moveInGrid(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (!target.dataset.emoji || !scroller.current) return;
    const buttons = [...scroller.current.querySelectorAll<HTMLButtonElement>("button[data-emoji]")];
    const index = buttons.indexOf(target as HTMLButtonElement);
    const top = target.offsetTop;
    const perRow = Math.max(1, buttons.slice(index).findIndex((button) => button.offsetTop !== top) + buttons.slice(0, index).reverse().findIndex((button) => button.offsetTop !== top) + 1) || 8;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -perRow, ArrowDown: perRow, Home: -index, End: buttons.length - 1 - index }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    buttons[Math.min(buttons.length - 1, Math.max(0, index + step))]?.focus();
  }

  const button = (emoji: string, name: string, first: boolean) => (
    <button
      key={emoji}
      type="button"
      data-emoji={emoji}
      // One stop in the tab order; the arrow keys do the rest.
      tabIndex={first ? 0 : -1}
      aria-label={name}
      title={name}
      className="emoji-cell"
      onClick={() => pick(emoji)}
    >
      {emoji}
    </button>
  );

  const nameOf = (emoji: string) => entries?.find((entry) => entry.e === emoji || entry.s?.includes(emoji))?.n ?? emoji;

  return (
    <dialog
      ref={dialog}
      className="emoji-picker"
      aria-label={label}
      onClose={onClose}
      onKeyDown={wrapTab}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A tap on the backdrop lands on the dialog itself; the panel fills everything else.
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="emoji-picker__panel">
        <div className="emoji-picker__head">
          <h2 className="emoji-picker__title">{heading ?? label}</h2>
          <DialogClose onClick={onClose} />
        </div>
        {stickers ? (
          <div role="tablist" aria-label={copy.emojiPicker.tabsLabel} className="emoji-picker__tabs" onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const next = tab === "emoji" ? "stickers" : "emoji";
            setTab(next);
            document.getElementById(`${tabsId}-${next}`)?.focus();
          }}>
            {(["emoji", "stickers"] as const).map((name) => (
              <button
                key={name}
                id={`${tabsId}-${name}`}
                type="button"
                role="tab"
                aria-selected={tab === name}
                aria-controls={`${tabsId}-panel`}
                tabIndex={tab === name ? 0 : -1}
                className="emoji-picker__tab"
                onClick={() => setTab(name)}
              >
                {name === "emoji" ? copy.emojiPicker.tabEmoji : copy.emojiPicker.tabStickers}
              </button>
            ))}
          </div>
        ) : null}
        <div className="emoji-picker__tools" hidden={onStickers}>
          <input
            ref={search}
            type="search"
            className="field h-11 min-w-0 flex-1 py-0"
            aria-label={copy.emojiPicker.searchLabel}
            placeholder={copy.emojiPicker.searchPlaceholder}
            value={query}
            enterKeyHint="done"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // A search field eats the first Escape to clear itself; here Escape always closes the picker.
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key !== "Enter") return;
              event.preventDefault();
              const first = typed ?? (results?.[0] ? toned(results[0]) : null);
              if (first) pick(first);
            }}
          />
          <select
            aria-label={copy.emojiPicker.toneLabel}
            className="emoji-picker__tone"
            value={tone}
            onChange={(event) => {
              const next = Number(event.target.value);
              setTone(next);
              store(TONE_KEY, String(next));
            }}
          >
            {["👋", "👋🏻", "👋🏼", "👋🏽", "👋🏾", "👋🏿"].map((hand, index) => (
              <option key={hand} value={index} aria-label={copy.emojiPicker.tones[index]}>{hand}</option>
            ))}
          </select>
        </div>

        <div ref={scroller} id={`${tabsId}-panel`} role={stickers ? "tabpanel" : undefined} aria-labelledby={stickers ? `${tabsId}-${tab}` : undefined} className="emoji-picker__grid" onKeyDown={moveInGrid}>
          {onStickers && stickers ? (
            <>
              {stickers.note ? <p className="emoji-picker__stickers-note">{stickers.note}</p> : null}
              <div className="sticker-picker__grid">
                {CHARM_KEYS.map((key) => {
                  const name = copy.stickers[key as keyof typeof copy.stickers] ?? key;
                  return (
                    <button key={key} type="button" className="sticker-picker__cell" aria-label={name} title={name} onClick={() => stickers.onPick(key)}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- A tiny static drawing; there is nothing for the image optimiser to do. */}
                      <img src={stickerSrc(key)} alt="" width={44} height={44} loading="lazy" />
                    </button>
                  );
                })}
              </div>
            </>
          ) : failed ? (
            <div className="emoji-picker__empty">
              <p>{copy.emojiPicker.loadFailed}</p>
              <button
                type="button"
                className="btn btn-quiet mt-2 h-11 text-[14px]"
                onClick={() => {
                  setFailed(false);
                  setAttempt((value) => value + 1);
                }}
              >
                {copy.emojiPicker.retry}
              </button>
            </div>
          ) : !entries ? (
            <p className="emoji-picker__empty" role="status">{copy.emojiPicker.loading}</p>
          ) : results ? (
            <>
              <p role="status" className="sr-only">
                {results.length === 0 && !typed ? copy.emojiPicker.empty : copy.emojiPicker.searched}
              </p>
              {typed || results.length > 0 ? (
                <div className="emoji-cells">
                  {typed ? button(typed, nameOf(typed), true) : null}
                  {results.map((entry, index) => button(toned(entry), entry.n, !typed && index === 0))}
                </div>
              ) : (
                <p className="emoji-picker__empty" aria-hidden="true">{copy.emojiPicker.empty}</p>
              )}
            </>
          ) : (
            <>
              {quick && quick.length > 0 ? (
                <section>
                  <h3 className="emoji-picker__group">{copy.emojiPicker.quick}</h3>
                  <div className="emoji-cells">
                    {quick.map((emoji, index) => button(emoji, nameOf(emoji), index === 0))}
                  </div>
                </section>
              ) : null}
              {recent.length > 0 ? (
                <section>
                  <h3 className="emoji-picker__group">{copy.emojiPicker.recent}</h3>
                  <div className="emoji-cells">
                    {recent.map((emoji, index) => button(emoji, nameOf(emoji), index === 0 && !(quick && quick.length > 0)))}
                  </div>
                </section>
              ) : null}
              {GROUPS.map((group, groupIndex) => {
                const inGroup = entries.filter((entry) => entry.g === group);
                return (
                  <section key={group} className="emoji-picker__section" style={{ containIntrinsicSize: `auto ${Math.ceil(inGroup.length / 8) * 44 + 40}px` }}>
                    <h3 className="emoji-picker__group">{copy.emojiPicker.groups[group]}</h3>
                    <div className="emoji-cells">
                      {inGroup.map((entry, index) => button(toned(entry), entry.n, recent.length === 0 && !(quick && quick.length > 0) && groupIndex === 0 && index === 0))}
                    </div>
                  </section>
                );
              })}
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
