"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { copy } from "@/lib/copy";

export type ContentsItem = { href: string; number: number | null; label: string };

/**
 * The way around a long issue, kept in reach while reading: the contents and, when
 * there is a choice, who to read. Closed, it costs one thin line; it opens over the
 * page and closes itself once you've picked somewhere to go.
 */
export function IssueBar({ contents, reading, readingLabel, title }: {
  contents: ContentsItem[];
  reading?: ReactNode;
  readingLabel?: string;
  title?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLSpanElement>(null);

  // The name only needs repeating once the page's own title has scrolled away.
  useEffect(() => {
    const mark = sentinel.current;
    const element = bar.current;
    if (!mark || !element) return;
    const watcher = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) element.removeAttribute("data-past-head");
      else element.setAttribute("data-past-head", "");
    });
    watcher.observe(mark);
    return () => watcher.disconnect();
  }, []);

  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const close = (except?: Element | null) =>
      element.querySelectorAll("details[open]").forEach((panel) => {
        if (panel !== except) panel.removeAttribute("open");
      });
    const onPointer = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const open = element.querySelector("details[open]");
      if (!open) return;
      close();
      open.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function onToggle(event: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open) return;
    bar.current?.querySelectorAll("details[open]").forEach((panel) => {
      if (panel !== event.currentTarget) panel.removeAttribute("open");
    });
  }

  if (contents.length <= 1 && !reading) return null;

  return (
    <>
    <span ref={sentinel} aria-hidden="true" className="-mb-6 block h-px" />
    <div ref={bar} className="issue-bar no-print">
      {contents.length > 1 ? (
        <details className="issue-bar__menu" onToggle={onToggle}>
          <summary className="issue-bar__button" aria-label={copy.issue.contentsButton}>
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 flex-none"><path d="M4 5.5h12M4 10h12M4 14.5h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <span className="issue-bar__word">{copy.issue.contentsButton}</span>
          </summary>
          <nav aria-labelledby="issue-contents-heading" className="issue-bar__panel issue-contents">
            <h2 id="issue-contents-heading" className="m-0 text-ink">{copy.issue.contents}</h2>
            <ol className="m-0 mt-1 list-none p-0">
              {contents.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    onClick={() => bar.current?.querySelectorAll("details[open]").forEach((panel) => panel.removeAttribute("open"))}
                    className="flex min-h-11 items-center gap-3 rounded-sm py-1 text-[15px] font-bold leading-snug text-ink no-underline hover:underline"
                  >
                    {item.number !== null ? (
                      <span aria-hidden="true" className="question-number numeric">{item.number}</span>
                    ) : null}
                    <span className="min-w-0 wrap-any">{item.label}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </details>
      ) : null}
      {reading ? (
        <details className="issue-bar__menu issue-bar__menu--grow" onToggle={onToggle}>
          <summary className="issue-bar__button">
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 flex-none"><path d="M3 6h14M6 10h8M8.5 14h3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <span className="min-w-0 wrap-any">{readingLabel}</span>
          </summary>
          <div className="issue-bar__panel">{reading}</div>
        </details>
      ) : null}
      {title ? <span className="issue-bar__title" aria-hidden="true">{title}</span> : null}
    </div>
    </>
  );
}
