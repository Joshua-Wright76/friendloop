"use client";

import { useEffect, useRef } from "react";
import { reportError } from "@/components/sentry-client";
import Link from "next/link";
import { Brand, Tape } from "@/components/stationery";
import { copy } from "@/lib/copy";

/** Anything a page throws lands here instead of the framework's bare 500. */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // A no-op without NEXT_PUBLIC_SENTRY_DSN. Server-rendered errors arrive
    // here with only a digest; the server side reported them via onRequestError.
    console.error(error);
    reportError(error);
    // The page someone was using just vanished; tell assistive tech what replaced it.
    heading.current?.focus();
  }, [error]);

  // A client error boundary cannot export metadata; name the page for the tab and for screen readers.
  useEffect(() => {
    document.title = `${copy.pageTitles.somethingWrong} · ${copy.common.brand}`;
  }, []);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start">
        <Brand />
      </div>
      <div className="card p-6 pt-8">
        <Tape tone="stripe" position="left" />
        <h1 ref={heading} tabIndex={-1} className="text-ink outline-none">{copy.common.errorPage.title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{copy.common.errorPage.body}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={() => retry()} className="btn btn-primary">
            {copy.common.errorPage.retry}
          </button>
          <Link href="/you" className="btn btn-quiet">
            {copy.common.errorPage.yourLoops}
          </Link>
        </div>
      </div>
    </main>
  );
}
