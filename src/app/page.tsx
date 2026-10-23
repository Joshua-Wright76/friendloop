import Link from "next/link";
import { Brand, Cherries, Tape } from "@/components/stationery";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[880px] flex-col px-5 py-6 sm:px-8 sm:py-8">
      <header className="flex items-center justify-between gap-4">
        <Brand />
        <Link href="/signin" className="text-[14px] font-bold text-ink-soft underline decoration-dashed underline-offset-4 hover:text-ink">
          Sign in
        </Link>
      </header>

      <div className="flex flex-1 items-center py-14 sm:py-20">
        <section className="card home-card ride-in w-full">
          <Tape tone="dots" position="left" />
          <Cherries className="home-doodle" />
          <p className="eyebrow">A little closer, every week</p>
          <h1 className="home-title mt-3 font-bold text-ink">
            A newsletter for your friends, <em>written by your friends.</em>
          </h1>
          <p className="mt-6 max-w-[48ch] text-[17px] leading-relaxed text-ink-soft">
            A few questions go out each week. Everyone answers in a sentence. It comes back as something worth reading.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href="/signin" className="btn btn-primary">Start a loop</Link>
            <span className="text-[14px] font-bold text-ink-soft">No group chat required.</span>
          </div>
        </section>
      </div>

      <footer className="flex flex-col gap-2 border-t border-dashed border-line-strong pt-5 text-[13px] leading-relaxed text-ink-muted sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0">Private by default. Thoughtful by design.</p>
        <p className="m-0">Answering questions? Use the link in your email — no account needed.</p>
      </footer>
    </main>
  );
}
