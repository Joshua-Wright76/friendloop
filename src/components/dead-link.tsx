import Link from "next/link";
import { Brand, Tape } from "@/components/stationery";
import { copy } from "@/lib/copy";

/**
 * The way out of a link that no longer works: whoever opens one can still sign in
 * and find their loops, rather than being told to look elsewhere with nothing to tap.
 */
export function DeadLinkAction() {
  return (
    <Link href="/signin" className="btn btn-primary mt-5 inline-flex">
      {copy.deadLink.signIn}
    </Link>
  );
}

/** A whole page for a dead link: the explanation stays, with a sign-in button under it. */
export function DeadLinkPage({ title, body, next }: { title: string; body: string; next?: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start"><Brand /></div>
      <div className="card p-6 pt-8">
        <Tape tone="stripe" position="center" />
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">{title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{body}</p>
        {next ? <p className="mt-3 text-[15px] font-bold leading-relaxed text-ink">{next}</p> : null}
        <DeadLinkAction />
      </div>
    </main>
  );
}
