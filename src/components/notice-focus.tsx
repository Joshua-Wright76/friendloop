"use client";

import { useEffect, useRef, type ReactNode } from "react";

const BASE = "notice settle border px-4 py-3 text-[14px] leading-relaxed outline-none";
const SUCCESS = "bg-accent-soft";
const DANGER = "rounded-xl border-danger/40 bg-danger/10 text-danger";

/**
 * A message that arrives with a server redirect. A live region that mounts with
 * its text is often not announced, so the notice takes focus once it is on the
 * page: errors are an alert, everything else a status.
 */
export function NoticeFocus({
  tone = "success",
  spacing = "mt-4",
  children,
}: {
  tone?: "success" | "danger";
  spacing?: string;
  children: ReactNode;
}) {
  const node = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = node.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <div
      ref={node}
      role={tone === "danger" ? "alert" : "status"}
      tabIndex={-1}
      className={`${BASE} ${tone === "danger" ? DANGER : SUCCESS} ${spacing}`}
    >
      {children}
    </div>
  );
}
