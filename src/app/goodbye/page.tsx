import Link from "next/link";
import type { Metadata } from "next";
import { Brand, Tape } from "@/components/stationery";
import { copy } from "@/lib/copy";

export const metadata: Metadata = {
  title: copy.goodbye.metadataTitle,
  robots: { index: false, follow: false },
};

/** Where account deletion and leaving a loop land: nothing of the person is left to show. */
export default function GoodbyePage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start">
        <Brand />
      </div>
      <div role="status" className="card settle p-6 pt-8">
        <Tape tone="mint" position="left" />
        <h1 className="text-ink">{copy.goodbye.title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{copy.goodbye.body}</p>
        <p className="mt-3 text-[15px] leading-relaxed text-ink">{copy.goodbye.closing}</p>
        <Link href="/" className="btn btn-primary mt-5 inline-flex">{copy.goodbye.home}</Link>
      </div>
    </main>
  );
}
