"use client";

import Link from "next/link";
import { copy } from "@/lib/copy";

const items = [
  ["Overview", "", copy.common.navigation.overview],
  ["People", "/members", copy.common.navigation.people],
  ["Questions", "/questions", copy.common.navigation.questions],
  ["Rounds", "/issues", copy.common.navigation.rounds],
  ["Settings", "/settings", copy.common.navigation.settings],
] as const;

export function LoopNav({ id, active, isOwner = false }: { id: string; active: (typeof items)[number][0]; isOwner?: boolean }) {
  return (
    <nav className="loop-nav" aria-label={copy.common.navigation.ariaLabel}>
      {items.filter(([key]) => key !== "Settings" || isOwner).map(([key, path, label]) => (
        <Link key={key} href={`/g/${id}${path}`} aria-current={key === active ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
