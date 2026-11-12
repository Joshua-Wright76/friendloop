import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Brand, Tape } from "@/components/stationery";
import { currentUser } from "@/lib/auth";
import { copy } from "@/lib/copy";

export const metadata: Metadata = { title: copy.pageTitles.notFound };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start">
        <Brand />
      </div>
      <div className="card p-6 pt-8">
        <Tape tone="mint" position="left" />
        <h1 className="text-ink">{copy.common.notFound.title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{copy.common.notFound.body}</p>
        <Suspense fallback={<HomeLink />}>
          <WayBack />
        </Suspense>
      </div>
    </main>
  );
}

function HomeLink({ signedIn = false }: { signedIn?: boolean }) {
  return signedIn ? (
    <Link href="/you" className="btn btn-primary mt-5 inline-flex">{copy.common.notFound.yourLoops}</Link>
  ) : (
    <div className="mt-5 flex flex-wrap gap-3">
      <Link href="/signin" className="btn btn-primary">{copy.deadLink.signIn}</Link>
      <Link href="/" className="btn btn-quiet">{copy.common.notFound.home}</Link>
    </div>
  );
}

/** Someone signed in is sent back to their loops rather than the landing page. */
async function WayBack() {
  return <HomeLink signedIn={Boolean(await currentUser())} />;
}
