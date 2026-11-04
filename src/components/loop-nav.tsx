"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Cherries } from "@/components/stationery";
import { copy, text } from "@/lib/copy";

const items = [
  ["Overview", "", copy.common.navigation.overview],
  ["People", "/members", copy.common.navigation.people],
  ["Questions", "/questions", copy.common.navigation.questions],
  ["Rounds", "/issues", copy.common.navigation.rounds],
  ["Album", "/album", copy.common.navigation.album],
  ["Settings", "/settings", copy.common.navigation.settings],
] as const;

type Access = keyof typeof copy.common.roles;

/**
 * The loop's header and tabs, the same on every tab: the loop name leads back to
 * all your loops, and the tabs move between sections of this one. On a narrow
 * screen the tabs scroll sideways; a soft fade on either edge says there is more,
 * and the current tab is brought into view.
 */
export function LoopNav({ id, name, access, active }: {
  id: string;
  name: string;
  access: Access;
  active: (typeof items)[number][0];
}) {
  const nav = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const element = nav.current;
    if (!element) return;
    const current = element.querySelector<HTMLElement>('[aria-current="page"]');
    if (current && element.scrollWidth > element.clientWidth) {
      // Not scrollIntoView: that would also scroll the page.
      element.scrollLeft = current.offsetLeft - (element.clientWidth - current.offsetWidth) / 2;
    }
    const update = () => setEdges({
      start: element.scrollLeft > 1,
      end: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
    });
    update();
    element.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      resize.disconnect();
    };
  }, [active]);

  return (
    <>
      <header className="stitched flex items-center justify-between gap-3 border-b pb-4">
        <Link href="/you" aria-label={text(copy.a11yLabels.loopsLink, { name })} className="flex min-h-11 min-w-0 items-center gap-2 font-display text-[23px] font-bold text-ink no-underline">
          <Cherries className="h-7 w-7 flex-none" /><span className="wrap-any">{name}</span>
        </Link>
        <span className="chip flex-none whitespace-nowrap border bg-card px-2.5 py-1 text-[12px] font-bold capitalize text-ink-soft">{copy.common.roles[access]}</span>
      </header>
      <nav
        ref={nav}
        className="loop-nav"
        aria-label={copy.common.navigation.ariaLabel}
        data-fade-start={edges.start ? "" : undefined}
        data-fade-end={edges.end ? "" : undefined}
      >
        {items.filter(([key]) => key !== "Settings" || access === "owner").map(([key, path, label]) => (
          <Link key={key} href={`/g/${id}${path}`} aria-current={key === active ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
    </>
  );
}
