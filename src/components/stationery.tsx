import Link from "next/link";
import { copy } from "@/lib/copy";
import type { IssueTheme } from "@/lib/issue-experience";

export function Cherries({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path d="M16 4c-2.5 6-6 10-8.6 13M16 4c1.2 6 4 9.6 7.6 12" fill="none" stroke="#5b8a4a" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 4c3-2.6 7.5-2.4 9.5.4-3.4 2-6.6 1.8-9.5-.4z" fill="#7cb35f" />
      <circle cx="8" cy="22" r="6" fill="#e0405e" />
      <circle cx="23.6" cy="21" r="6" fill="#e0405e" />
      <circle cx="5.8" cy="19.8" r="1.7" fill="#fff" opacity=".75" />
      <circle cx="21.4" cy="18.8" r="1.7" fill="#fff" opacity=".75" />
    </svg>
  );
}

export function ThemeMark({ theme, className = "" }: { theme: IssueTheme; className?: string }) {
  if (theme === "picnic") return <Cherries className={className} />;
  const pack = copy.themes.packs.find((option) => option.value === theme);
  return (
    <span aria-hidden="true" className={`theme-mark ${className}`}>
      {pack?.emoji ?? copy.common.cherry}
    </span>
  );
}

export function Brand({ href = "/" }: { href?: string | null }) {
  const content = (
    <>
      <Cherries className="brand-cherries" />
      <span>{copy.common.brand}</span>
    </>
  );

  return href ? <Link href={href} className="brand">{content}</Link> : <span className="brand">{content}</span>;
}

export function Tape({ tone = "dots", position = "left" }: { tone?: "dots" | "stripe" | "mint" | "check"; position?: "left" | "right" | "center" }) {
  return <i aria-hidden="true" className={`tape tape-${tone} tape-${position}`} />;
}

export function Envelope() {
  return (
    <svg className="envelope" viewBox="0 0 120 90" aria-hidden="true">
      <path className="envelope-paper" d="M14 24c-1-5 2-8 7-8h78c5 0 8 3 7 8l-2 46c0 5-3 8-8 8H24c-5 0-8-3-8-8z" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M15 21l45 32 44-32" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M60 66c-7-4.5-10-8.5-9.5-12 .4-3 3.4-4.4 5.7-3.4 1.6.7 2.9 1.9 3.8 3.5.9-1.6 2.2-2.8 3.8-3.5 2.3-1 5.3.4 5.7 3.4.5 3.5-2.5 7.5-9.5 12z" fill="#e0405e" />
    </svg>
  );
}
