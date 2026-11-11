import type { Metadata } from "next";
import Link from "next/link";
import { Brand, Tape } from "@/components/stationery";
import { copy } from "@/lib/copy";

export const metadata: Metadata = { title: copy.pageTitles.notFound };

/** A dead share link is usually opened by someone outside the loop: say what happened and who can help. */
export default function SharedIssueGone() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start">
        <Brand />
      </div>
      <div className="card p-6 pt-8">
        <Tape tone="mint" position="left" />
        <h1 className="text-ink">{copy.share.goneTitle}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{copy.share.goneBody}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/signin" className="btn btn-primary">{copy.deadLink.signIn}</Link>
          <Link href="/" className="btn btn-quiet">{copy.share.goneHome}</Link>
        </div>
      </div>
    </main>
  );
}
