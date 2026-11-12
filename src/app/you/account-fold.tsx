"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * An account section. On a wide screen it simply shows in the side column; on a phone it
 * folds to one quiet line under the loops, so the loops are what the page is about.
 */
export function AccountFold({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const fold = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (fold.current && window.matchMedia("(max-width: 1023px)").matches) fold.current.open = false;
  }, []);
  return (
    <section aria-labelledby={id}>
      <details ref={fold} className="account-fold" open>
        <summary className="account-fold__summary">
          <h3 id={id} className="text-ink">{title}</h3>
          <svg viewBox="0 0 20 20" aria-hidden="true" className="account-fold__chevron"><path d="m5.5 8 4.5 4.5L14.5 8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </summary>
        <div className="account-fold__body">{children}</div>
      </details>
    </section>
  );
}
