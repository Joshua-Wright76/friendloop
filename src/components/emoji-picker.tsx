"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { copy } from "@/lib/copy";

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

/**
 * Any emoji at all, searchable. A native dialog, so focus stays inside, Escape closes
 * it and focus goes back to the button that opened it. It's a bottom sheet on a phone
 * and a centred card elsewhere. Arrow keys move through the grid, so tabbing doesn't
 * mean walking through two thousand buttons.
 */
export function EmojiPicker({ label, onPick, onClose }: { label: string; onPick: (emoji: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    // React takes the dialog off the page before this cleanup runs, and a dialog that's
    // already gone can't hand focus back on its own, so it's done by hand.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node.showModal();
    // On a phone, opening the keyboard would hide the very grid someone came to browse.
    if (window.matchMedia("(pointer: fine)").matches) search.current?.focus();
    return () => {
      node.close();
      opener?.focus();
    };
  }, []);

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
    return entries.filter((entry) => searchable(entry, words));
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
          <h2 className="emoji-picker__title">{copy.emojiPicker.title}</h2>
          <button type="button" className="link link--quiet min-h-11 cursor-pointer text-[14px] font-bold" onClick={onClose}>{copy.common.close}</button>
        </div>
        <div className="emoji-picker__tools">
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

        <div ref={scroller} className="emoji-picker__grid" onKeyDown={moveInGrid}>
          {failed ? (
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
              {recent.length > 0 ? (
                <section>
                  <h3 className="emoji-picker__group">{copy.emojiPicker.recent}</h3>
                  <div className="emoji-cells">
                    {recent.map((emoji, index) => button(emoji, nameOf(emoji), index === 0))}
                  </div>
                </section>
              ) : null}
              {GROUPS.map((group, groupIndex) => {
                const inGroup = entries.filter((entry) => entry.g === group);
                return (
                  <section key={group} className="emoji-picker__section" style={{ containIntrinsicSize: `auto ${Math.ceil(inGroup.length / 8) * 44 + 40}px` }}>
                    <h3 className="emoji-picker__group">{copy.emojiPicker.groups[group]}</h3>
                    <div className="emoji-cells">
                      {inGroup.map((entry, index) => button(toned(entry), entry.n, recent.length === 0 && groupIndex === 0 && index === 0))}
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
