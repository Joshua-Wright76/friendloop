"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Cherries } from "@/components/stationery";
import { LoopSnapshot } from "@/components/loop-theme";
import { copy, text } from "@/lib/copy";

const ICONS: Record<string, ReactNode> = {
  // One hand: 1.7 stroke, round caps, drawn on a 22 grid.
  Overview: <path d="M4 10.2 11 4.5l7 5.7V18a.8.8 0 0 1-.8.8H4.8A.8.8 0 0 1 4 18zM9 18.8V13h4v5.8" />,
  People: <path d="M8.3 10.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM2.6 18.4c.4-3.3 2.7-5.2 5.7-5.2s5.3 1.9 5.7 5.2M14.6 4.5a3 3 0 0 1 0 5.7M16.2 13.5c1.9.6 3 2.3 3.2 4.6" />,
  Questions: <path d="M4 5.6c0-.9.7-1.6 1.6-1.6h10.8c.9 0 1.6.7 1.6 1.6v7.8c0 .9-.7 1.6-1.6 1.6H9.2L5.6 18v-3H5.6A1.6 1.6 0 0 1 4 13.4zM8.8 8.2a2.2 2.2 0 1 1 3.3 1.9c-.7.4-1.1.9-1.1 1.6M11 13.4h.01" />,
  Rounds: <path d="M18.4 11a7.4 7.4 0 0 1-12.9 5M3.6 11a7.4 7.4 0 0 1 12.9-5M16.5 2.8V6h-3.2M5.5 19.2V16h3.2" />,
  Album: <path d="M4.6 4h12.8c.9 0 1.6.7 1.6 1.6v10.8c0 .9-.7 1.6-1.6 1.6H4.6A1.6 1.6 0 0 1 3 16.4V5.6C3 4.7 3.7 4 4.6 4ZM3 14.6l4.3-4 3.4 3.1 2.3-2 5 4.3M13.8 8.6h.01" />,
  Settings: <path d="M4 6.5h6.2M14.6 6.5H18M4 15.5h3.4M11.8 15.5H18M12.4 8.7a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4ZM9.6 17.7a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" />,
};

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
 * The loop's letterhead, the same on every tab: the loop name leads back to all
 * your loops and the page's own title sits under it. The tabs are underlined on a
 * wide screen and become a fixed bar on a phone, where every destination stays in
 * view and in the same place.
 */
export function LoopNav({ id, name, access, active, nameIsHeading = false, snapshotUrl = null, children }: {
  id: string;
  name: string;
  access: Access;
  active: (typeof items)[number][0];
  /** The overview has no title of its own: the loop's name is the page's heading. */
  nameIsHeading?: boolean;
  /** The loop's picture, as a small taped snapshot. */
  snapshotUrl?: string | null;
  /** The page's title and one line about it. */
  children?: ReactNode;
}) {
  const nameNode = <span className="wrap-any">{name}</span>;
  return (
    <div className={`loop-head${snapshotUrl ? " has-snapshot" : ""}`}>
      <LoopSnapshot url={snapshotUrl} />
      <header className="loop-head__row">
        <Link href="/you" title={copy.common.yourLoops} aria-label={text(copy.a11yLabels.loopsLink, { name })} className="loop-head__home">
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 flex-none text-ink-muted"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <Cherries className="h-7 w-7 flex-none" />
          {nameIsHeading ? <h1 className="loop-head__name">{nameNode}</h1> : <span className="loop-head__name">{nameNode}</span>}
        </Link>
        {/* The owner knows they own it. The badge is for anyone wondering what they can do here. */}
        {access === "owner" ? null : <span className="chip flex-none whitespace-nowrap border bg-card px-2.5 py-1 text-[12px] font-bold capitalize text-ink-soft">{copy.common.roles[access]}</span>}
      </header>
      <nav className="loop-nav no-print" aria-label={copy.common.navigation.ariaLabel}>
        {items.filter(([key]) => key !== "Settings" || access === "owner").map(([key, path, label]) => (
          <Link key={key} href={`/g/${id}${path}`} aria-current={key === active ? "page" : undefined}>
            <svg viewBox="0 0 22 22" aria-hidden="true" className="loop-nav__icon" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{ICONS[key]}</svg>
            {label}
          </Link>
        ))}
      </nav>
      {children ? <div className="loop-head__page">{children}</div> : null}
    </div>
  );
}
